export interface AmpUser {
    // There's a ton of different properties here, but these are the ones we care about
    user_id: number;
    login: string;
    name_f: string;
    name_l: string;
    email: string;
    fob: string;
    fob_access: string;
    roles: string[];
    added: string;
    nested: {
        access: {
            access_id: number;
            invoice_id: string;
            invoice_public_id: string;
            invoice_payment_id: string;
            invoice_item_id: string;
            user_id: string;
            product_id: string;
            transaction_id: string;
            begin_date: string;
            expire_date: string;
            qty: string;
        }[];
        invoices: {
            invoice_id: number;
            user_id: string;
            paysys_id: string;
            first_subtotal: string;
            first_total: string;
            second_subtotal: string;
            second_total: string;
            rebill_times: string;
            public_id: string;
            invoice_key: string;
        }[];
    };
}

export interface AmpProduct {
    product_id: number;
    title: string;
    renewal_group: string;
    nested: {
        "product-product-category": {
            product_product_category_id: number;
            product_id: string;
            product_category_id: string;
        }[];
    };
}

export interface AmpProductCategory {
    product_category_id: number;
    title: string;
    parent_id: string;
    code: string;
}