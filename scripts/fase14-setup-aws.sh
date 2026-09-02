#!/usr/bin/env bash
# scripts/fase14-setup-aws.sh
#
# ADR-0003 Fase 14 — Setup completo: recriar SQS+DLQ+ESM, deletar/limpar Fase 13, Provisioned Concurrency.
# REQUISITOS: aws CLI configurado com profile `renthus` (sa-east-1).
# JANELA DE BAIXO TRÁFEGO recomendada.

set -euo pipefail

PROFILE="renthus"
REGION="sa-east-1"
ACCOUNT="696457893414"

INBOUND_QUEUE="renthus-inbound.fifo"
INBOUND_DLQ="renthus-inbound-dlq.fifo"
INBOUND_LAMBDA="renthus-inbound-worker"
INBOUND_LAMBDA_ALIAS="live"
INBOUND_LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT}:function:${INBOUND_LAMBDA}:${INBOUND_LAMBDA_ALIAS}"

# 1. Limpar Fase 13 (recursos órfãos)
echo "--- 1. Cleanup Fase 13 ---"
aws --profile "$PROFILE" --region "$REGION" events delete-rule --name "renthus-inbound-keep-warm-1m" 2>/dev/null || true
aws --profile "$PROFILE" --region "$REGION" lambda remove-permission --function-name "$INBOUND_LAMBDA" --statement-id "eventbridge-inbound-keep-warm" 2>/dev/null || true
aws --profile "$PROFILE" --region "$REGION" iam detach-user-policy --user-name "renthus_servicos" --policy-arn "arn:aws:iam::${ACCOUNT}:policy/renthus-vercel-lambda-invoke-fase13" 2>/dev/null || true
aws --profile "$PROFILE" --region "$REGION" iam delete-policy --policy-arn "arn:aws:iam::${ACCOUNT}:policy/renthus-vercel-lambda-invoke-fase13" 2>/dev/null || true
rm -f lib/chatbot/inbound/lambdaInvoker.ts lib/chatbot/inbound/lambdaInvoker.aws.ts lib/chatbot/inbound/lambdaInvoker.noop.ts
rm -f lib/chatbot/queue/outboxDlqWatchdog.ts
rm -f workers/inbound/threadLock.ts workers/inbound/threadLock.errors.ts
rm -f supabase/migrations/20260901000001_thread_locks.sql
rmdir lib/chatbot/inbound 2>/dev/null || true
echo "Fase 13 cleanup OK"

# 2. Criar DLQ inbound
echo "--- 2. Create DLQ ---"
aws --profile "$PROFILE" --region "$REGION" sqs create-queue --queue-name "$INBOUND_DLQ" --attributes 'FifoQueue=true,ContentBasedDeduplication=false' >/dev/null || true
DLQ_ARN=$(aws --profile "$PROFILE" --region "$REGION" sqs get-queue-attributes --queue-url "https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${INBOUND_DLQ}" --query 'Attributes.QueueArn' --output text)

# 3. Criar fila inbound (Fase 14 — VisibilityTimeout=60s, maxReceiveCount=1)
echo "--- 3. Create inbound queue ---"
INBOUND_ATTRS='{"FifoQueue":"true","ContentBasedDeduplication":"false","VisibilityTimeout":"60","ReceiveMessageWaitTimeSeconds":"20","MessageRetentionPeriod":"1209600","RedrivePolicy":{"deadLetterTargetArn":"'$DLQ_ARN'","maxReceiveCount":1}}'
INBOUND_FILE=$(mktemp); echo "$INBOUND_ATTRS" > "$INBOUND_FILE"
aws --profile "$PROFILE" --region "$REGION" sqs create-queue --queue-name "$INBOUND_QUEUE" --attributes "file://$INBOUND_FILE" 2>/dev/null || true
rm -f "$INBOUND_FILE"
INBOUND_ARN=$(aws --profile "$PROFILE" --region "$REGION" sqs get-queue-attributes --queue-url "https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${INBOUND_QUEUE}" --query 'Attributes.QueueArn' --output text)
INBOUND_URL="https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${INBOUND_QUEUE}"
echo "Inbound queue: $INBOUND_URL"

# 4. Criar ESM
echo "--- 4. Create ESM ---"
SCALING_FILE=$(mktemp); echo '{"MaximumConcurrency":10}' > "$SCALING_FILE"
aws --profile "$PROFILE" --region "$REGION" lambda create-event-source-mapping \
  --function-name "$INBOUND_LAMBDA_ARN" \
  --event-source-arn "$INBOUND_ARN" \
  --batch-size 1 \
  --function-response-types ReportBatchItemFailures \
  --scaling-config "file://$SCALING_FILE" \
  --enabled
rm -f "$SCALING_FILE"

# 5. Lambda timeout 60s
echo "--- 5. Update Lambda timeout ---"
aws --profile "$PROFILE" --region "$REGION" lambda update-function-configuration --function-name "$INBOUND_LAMBDA" --timeout 60 --memory-size 1024

# 6. Provisioned Concurrency=1 (resolve cold-start)
echo "--- 6. Provisioned Concurrency=1 ---"
aws --profile "$PROFILE" --region "$REGION" lambda put-provisioned-concurrency-config \
  --function-name "$INBOUND_LAMBDA" \
  --qualifier "$INBOUND_LAMBDA_ALIAS" \
  --provisioned-concurrent-executions 1

# 7. IAM Vercel policy (sqs:SendMessage)
echo "--- 7. IAM Vercel policy ---"
POLICY_DOC='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["sqs:SendMessage","sqs:GetQueueUrl"],"Resource":"arn:aws:sqs:'$REGION':'$ACCOUNT':'$INBOUND_QUEUE'"}]}'
POLICY_NAME="renthus-vercel-sqs-send-fase14"
POLICY_ARN="arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}"
POLICY_FILE=$(mktemp); echo "$POLICY_DOC" > "$POLICY_FILE"
aws --profile "$PROFILE" --region "$REGION" iam create-policy --policy-name "$POLICY_NAME" --policy-document "file://$POLICY_FILE" 2>/dev/null || \
  aws --profile "$PROFILE" --region "$REGION" iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document "file://$POLICY_FILE" --set-as-default >/dev/null
rm -f "$POLICY_FILE"
aws --profile "$PROFILE" --region "$REGION" iam attach-user-policy --user-name "renthus_servicos" --policy-arn "$POLICY_ARN"

# 8. Vercel env vars (manual via vercel env add)
cat <<EOF
--- 8. Vercel env vars (manual via vercel dashboard ou CLI) ---
Adicionar:
  SQS_INBOUND_QUEUE_URL=$INBOUND_URL
  SQS_DISPATCH_ENABLED=1
Remover:
  AWS_LAMBDA_INBOUND_NAME
  AWS_LAMBDA_INBOUND_QUALIFIER
EOF

echo ""
echo "=== Fase 14 setup completo ==="
echo "Lambda inbound: $INBOUND_LAMBDA_ARN (timeout 60s, provisioned 1)"
echo "SQS inbound:    $INBOUND_URL (VT 60s, maxReceiveCount 1)"
echo "DLQ inbound:    $INBOUND_DLQ"
echo "Latencia alvo:  p95 <5s"