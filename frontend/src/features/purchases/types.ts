export interface Purchase {
  id: number;
  item: string;
  category: string | null;
  price: number | null;
  purchased_at: string | null;
}

export interface NewPurchase {
  item: string;
  category?: string;
  price?: number;
  purchased_at?: string;
}
