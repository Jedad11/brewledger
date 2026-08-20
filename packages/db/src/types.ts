export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      bom_lines: {
        Row: {
          id: string
          ingredient_id: string
          menu_item_id: string
          qty_base_unit: number
          store_id: string
        }
        Insert: {
          id?: string
          ingredient_id: string
          menu_item_id: string
          qty_base_unit: number
          store_id: string
        }
        Update: {
          id?: string
          ingredient_id?: string
          menu_item_id?: string
          qty_base_unit?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_financials: {
        Row: {
          business_date: string
          gross_revenue_satang: number
          id: string
          net_profit_satang: number | null
          order_count: number
          other_expense_satang: number
          store_id: string
          total_cogs_satang: number | null
          untracked_item_count: number
        }
        Insert: {
          business_date: string
          gross_revenue_satang?: number
          id?: string
          net_profit_satang?: number | null
          order_count?: number
          other_expense_satang?: number
          store_id: string
          total_cogs_satang?: number | null
          untracked_item_count?: number
        }
        Update: {
          business_date?: string
          gross_revenue_satang?: number
          id?: string
          net_profit_satang?: number | null
          order_count?: number
          other_expense_satang?: number
          store_id?: string
          total_cogs_satang?: number | null
          untracked_item_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_financials_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          base_unit: string
          current_stock_base_unit: number
          current_unit_cost_satang: number | null
          id: string
          low_stock_threshold: number | null
          name: string
          store_id: string
          updated_at: string
        }
        Insert: {
          base_unit: string
          current_stock_base_unit?: number
          current_unit_cost_satang?: number | null
          id?: string
          low_stock_threshold?: number | null
          name: string
          store_id: string
          updated_at?: string
        }
        Update: {
          base_unit?: string
          current_stock_base_unit?: number
          current_unit_cost_satang?: number | null
          id?: string
          low_stock_threshold?: number | null
          name?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          run_after: string | null
          status: string
          store_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          run_after?: string | null
          status?: string
          store_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          run_after?: string | null
          status?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          availability: string
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_path: string | null
          name: string
          price_satang: number
          sort_order: number
          store_id: string
        }
        Insert: {
          availability?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name: string
          price_satang: number
          sort_order?: number
          store_id: string
        }
        Update: {
          availability?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name?: string
          price_satang?: number
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_option_groups: {
        Row: {
          id: string
          is_required: boolean
          max_select: number
          menu_item_id: string
          min_select: number
          name: string
          sort_order: number
          store_id: string
        }
        Insert: {
          id?: string
          is_required?: boolean
          max_select?: number
          menu_item_id: string
          min_select?: number
          name: string
          sort_order?: number
          store_id: string
        }
        Update: {
          id?: string
          is_required?: boolean
          max_select?: number
          menu_item_id?: string
          min_select?: number
          name?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_option_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_option_groups_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_options: {
        Row: {
          id: string
          name: string
          option_group_id: string
          price_delta_satang: number
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          option_group_id: string
          price_delta_satang?: number
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          option_group_id?: string
          price_delta_satang?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_options_option_group_id_fkey"
            columns: ["option_group_id"]
            isOneToOne: false
            referencedRelation: "menu_option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          phone: string
          subscription_tier: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          phone: string
          subscription_tier?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          phone?: string
          subscription_tier?: string
        }
        Relationships: []
      }
      order_item_options: {
        Row: {
          id: string
          menu_option_id: string | null
          option_group_name_snapshot: string
          option_name_snapshot: string
          order_item_id: string
          price_delta_snapshot_satang: number
        }
        Insert: {
          id?: string
          menu_option_id?: string | null
          option_group_name_snapshot: string
          option_name_snapshot: string
          order_item_id: string
          price_delta_snapshot_satang?: number
        }
        Update: {
          id?: string
          menu_option_id?: string | null
          option_group_name_snapshot?: string
          option_name_snapshot?: string
          order_item_id?: string
          price_delta_snapshot_satang?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_options_menu_option_id_fkey"
            columns: ["menu_option_id"]
            isOneToOne: false
            referencedRelation: "menu_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_options_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          item_name_snapshot: string
          menu_item_id: string | null
          options_snapshot: Json
          order_id: string
          quantity: number
          store_id: string
          unit_cost_snapshot_satang: number | null
          unit_price_snapshot_satang: number
        }
        Insert: {
          id?: string
          item_name_snapshot: string
          menu_item_id?: string | null
          options_snapshot?: Json
          order_id: string
          quantity: number
          store_id: string
          unit_cost_snapshot_satang?: number | null
          unit_price_snapshot_satang: number
        }
        Update: {
          id?: string
          item_name_snapshot?: string
          menu_item_id?: string | null
          options_snapshot?: Json
          order_id?: string
          quantity?: number
          store_id?: string
          unit_cost_snapshot_satang?: number | null
          unit_price_snapshot_satang?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          channel: string
          created_at: string
          customer_name: string
          customer_phone: string | null
          expires_at: string | null
          id: string
          order_code: string
          paid_at: string | null
          payment_confirmed_at: string | null
          payment_confirmed_by: string | null
          pickup_slot_id: string | null
          refund_status: string | null
          status: string
          store_id: string
          subtotal_satang: number
          total_cost_snapshot_satang: number | null
          total_satang: number
        }
        Insert: {
          channel?: string
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          expires_at?: string | null
          id?: string
          order_code: string
          paid_at?: string | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          pickup_slot_id?: string | null
          refund_status?: string | null
          status?: string
          store_id: string
          subtotal_satang: number
          total_cost_snapshot_satang?: number | null
          total_satang: number
        }
        Update: {
          channel?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          expires_at?: string | null
          id?: string
          order_code?: string
          paid_at?: string | null
          payment_confirmed_at?: string | null
          payment_confirmed_by?: string | null
          pickup_slot_id?: string | null
          refund_status?: string | null
          status?: string
          store_id?: string
          subtotal_satang?: number
          total_cost_snapshot_satang?: number | null
          total_satang?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_pickup_slot_id_fkey"
            columns: ["pickup_slot_id"]
            isOneToOne: false
            referencedRelation: "pickup_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_satang: number
          created_at: string
          expires_at: string | null
          id: string
          method: string
          order_id: string
          payee_alias: string
          qr_payload: string | null
          status: string
          store_id: string
        }
        Insert: {
          amount_satang: number
          created_at?: string
          expires_at?: string | null
          id?: string
          method?: string
          order_id: string
          payee_alias: string
          qr_payload?: string | null
          status: string
          store_id: string
        }
        Update: {
          amount_satang?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          method?: string
          order_id?: string
          payee_alias?: string
          qr_payload?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_slots: {
        Row: {
          booked_count: number
          capacity: number
          id: string
          is_open: boolean
          slot_end: string
          slot_start: string
          store_id: string
        }
        Insert: {
          booked_count?: number
          capacity: number
          id?: string
          is_open?: boolean
          slot_end: string
          slot_start: string
          store_id: string
        }
        Update: {
          booked_count?: number
          capacity?: number
          id?: string
          is_open?: boolean
          slot_end?: string
          slot_start?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_slots_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string
          id: string
          image_path: string
          invoice_date: string | null
          ocr_status: string
          raw_ocr_output: Json | null
          review_status: string
          store_id: string
          total_satang: number | null
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_path: string
          invoice_date?: string | null
          ocr_status?: string
          raw_ocr_output?: Json | null
          review_status?: string
          store_id: string
          total_satang?: number | null
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string
          invoice_date?: string | null
          ocr_status?: string
          raw_ocr_output?: Json | null
          review_status?: string
          store_id?: string
          total_satang?: number | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_line_items: {
        Row: {
          id: string
          ingredient_id: string | null
          invoice_id: string
          mapping_confidence: number | null
          qty_base_unit: number | null
          raw_text: string | null
          store_id: string
          total_satang: number | null
          unit_cost_satang: number | null
        }
        Insert: {
          id?: string
          ingredient_id?: string | null
          invoice_id: string
          mapping_confidence?: number | null
          qty_base_unit?: number | null
          raw_text?: string | null
          store_id: string
          total_satang?: number | null
          unit_cost_satang?: number | null
        }
        Update: {
          id?: string
          ingredient_id?: string | null
          invoice_id?: string
          mapping_confidence?: number | null
          qty_base_unit?: number | null
          raw_text?: string | null
          store_id?: string
          total_satang?: number | null
          unit_cost_satang?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          created_at: string
          delta_base_unit: number
          id: string
          ingredient_id: string
          order_id: string | null
          purchase_invoice_id: string | null
          reason: string
          store_id: string
        }
        Insert: {
          created_at?: string
          delta_base_unit: number
          id?: string
          ingredient_id: string
          order_id?: string | null
          purchase_invoice_id?: string | null
          reason: string
          store_id: string
        }
        Update: {
          created_at?: string
          delta_base_unit?: number
          id?: string
          ingredient_id?: string
          order_id?: string | null
          purchase_invoice_id?: string | null
          reason?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          closes_at: string | null
          created_at: string
          default_slot_capacity: number
          id: string
          is_published: boolean
          merchant_id: string
          name: string
          opens_at: string | null
          pickup_address: string | null
          promptpay_id: string | null
          promptpay_type: string | null
          promptpay_verified_at: string | null
          slug: string
          timezone: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          default_slot_capacity?: number
          id?: string
          is_published?: boolean
          merchant_id: string
          name: string
          opens_at?: string | null
          pickup_address?: string | null
          promptpay_id?: string | null
          promptpay_type?: string | null
          promptpay_verified_at?: string | null
          slug: string
          timezone?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          default_slot_capacity?: number
          id?: string
          is_published?: boolean
          merchant_id?: string
          name?: string
          opens_at?: string | null
          pickup_address?: string | null
          promptpay_id?: string | null
          promptpay_type?: string | null
          promptpay_verified_at?: string | null
          slug?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
