export interface ItemCatalog {
  id: string;
  name: string;
  category: 'Material' | 'Labor' | 'Equipment' | string;
  unit: string;
  unit_cost: number;
}

export interface Quote {
  id: string;
  client_number: string;
  total_amount: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | string;
  project_name: string;
  created_at: string;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  item_catalog_id: string | null;
  parent_line_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  scope_of_work?: string;
}
