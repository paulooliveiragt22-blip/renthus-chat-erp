/**
 * lib/whatsapp/flowCrypto.ts
 *
 * Criptografia para WhatsApp Flows (Meta).
 *
 * Decryption (request):
 *   1. Decripta a AES key usando RSA-OAEP SHA-256 com a chave privada
 *   2. Decripta os dados do Flow usando AES-256-GCM
 *
 * Encryption (response):
 *   1. Usa a mesma AES key
 *   2. IV da resposta = IV da requisição com bytes invertidos
 *   3. Encripta com AES-256-GCM, concatena ciphertext + auth tag
 *
 * Variável de ambiente: WHATSAPP_FLOWS_PRIVATE_KEY (RSA PEM, PKCS#8)
 */

import { createDecipheriv, createCipheriv, privateDecrypt, constants } from "crypto";

export interface FlowDecryptResult {
    body:   Record<string, unknown>;
    aesKey: Buffer;
    iv:     Buffer;
}

export function decryptFlowRequest(
    encryptedFlowData: string,
    encryptedAesKey:   string,
    initialVector:     string,
    privateKeyPem:     string
): FlowDecryptResult {
    // Normaliza quebras de linha (Vercel pode armazenar \r\n ou \\n literais)
    const normalizedKey = privateKeyPem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");

    // Etapa 1: decripta a AES key usando RSA-OAEP SHA-256
    const aesKey = privateDecrypt(
        {
            key:      normalizedKey,
            padding:  constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
        },
        Buffer.from(encryptedAesKey, "base64")
    );

    // Etapa 2: decripta os dados usando AES-256-GCM
    const iv              = Buffer.from(initialVector, "base64");
    const encryptedBuffer = Buffer.from(encryptedFlowData, "base64");

    // Os últimos 16 bytes são a tag de autenticação GCM
    const TAG_LEN    = 16;
    const ciphertext = encryptedBuffer.subarray(0, -TAG_LEN);
    const authTag    = encryptedBuffer.subarray(-TAG_LEN);

    const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return {
        body:   JSON.parse(decrypted.toString("utf8")),
        aesKey,
        iv,
    };
}

export function encryptFlowResponse(
    responseBody: Record<string, unknown>,
    aesKey: Buffer,
    iv:     Buffer
): string {
    // IV da resposta = bytes do IV da requisição invertidos
    const responseIv = Buffer.from(iv).reverse();

    const cipher    = createCipheriv("aes-256-gcm", aesKey, responseIv);
    const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(responseBody), "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Ciphertext + auth tag (16 bytes) → base64
    return Buffer.concat([encrypted, authTag]).toString("base64");
}
