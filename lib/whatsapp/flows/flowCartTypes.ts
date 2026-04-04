/** Item do carrinho nos flows WhatsApp (checkout + catálogo). */
export type CartItem = {
    name:       string;
    qty:        number;
    price:      number;
    variantId?: string;
    productId?: string;
    isCase?:    boolean;
};
