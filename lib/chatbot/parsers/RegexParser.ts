/**
 * lib/chatbot/parsers/RegexParser.ts
 *
 * Parser nível 2: wrapper ao redor do OrderParserService (Regex + Fuse.js).
 * Mantém toda a lógica existente; apenas expõe como função autônoma.
 */

import { getOrderParserService } from "../OrderParserService";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";

export async function parseWithRegex(
    input: string,
    products: ProductForSearch[]
): Promise<ParseIntentResult> {
    const parser = getOrderParserService();
    return parser.parseIntent(input, products, { validateAddressWithGoogle: true });
}
