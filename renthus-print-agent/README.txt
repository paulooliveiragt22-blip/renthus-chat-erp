Renthus Print Agent — Instruções simples

1) O que é:
   Este programa conecta sua impressora ao Renthus ERP. Ele busca pedidos e imprime automaticamente.

2) O que vem nesta pasta:
   - printAgent.advanced.js  (o programa)
   - package.json            (descrição rápida das dependências)
   - printers.json (exemplo de configuração da sua impressora)

3) Como configurar (simples):
   - Defina as variáveis (isso é só colar estes valores quando pedir):
     * API_BASE = URL do seu ERP (ex: https://app-sualoja.com/api/print)
     * AGENT_KEY = chave secreta que o ERP gera para você
     * AGENT_PORT = 4001 (padrão) — só se quiser mudar

4) Como executar:
   - Em um computador com Node.js instalado:
     * abrir pasta e rodar: npm install
     * depois: npm start
   - O programa vai ficar rodando e imprimir pedidos automaticamente.

5) Ajuda:
   - Se a impressora não imprimir, verifique o `printers.json` e troque as configurações por um técnico local.
