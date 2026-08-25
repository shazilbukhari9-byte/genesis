export interface Purchase {
  id: number;
  item: string;
  category: string | null;
  price: number | null;
  purchased_at: string | null;
}

export interface Budget {
  monthly_limit: number | null;
}
