export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      auth_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip_hash: string | null
          phone_hash: string | null
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip_hash?: string | null
          phone_hash?: string | null
        }
        Update: {
          attempted_at?: string
          id?: string
          ip_hash?: string | null
          phone_hash?: string | null
        }
        Relationships: []
      }
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
          archived_at: string | null
          base_unit: string
          current_stock_base_unit: number
          current_unit_cost_satang: number | null
          id: string
          low_stock_threshold: number | null
          name: string
          pack_size: number | null
          store_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          base_unit: string
          current_stock_base_unit?: number
          current_unit_cost_satang?: number | null
          id?: string
          low_stock_threshold?: number | null
          name: string
          pack_size?: number | null
          store_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          base_unit?: string
          current_stock_base_unit?: number
          current_unit_cost_satang?: number | null
          id?: string
          low_stock_threshold?: number | null
          name?: string
          pack_size?: number | null
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
      order_lookup_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip_hash: string | null
          phone_hash: string | null
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip_hash?: string | null
          phone_hash?: string | null
        }
        Update: {
          attempted_at?: string
          id?: string
          ip_hash?: string | null
          phone_hash?: string | null
        }
        Relationships: []
      }
      order_status_history: {
        Row: {
          actor: string | null
          actor_type: string
          created_at: string
          from_status: string
          id: string
          order_id: string
          to_status: string
        }
        Insert: {
          actor?: string | null
          actor_type: string
          created_at?: string
          from_status: string
          id?: string
          order_id: string
          to_status: string
        }
        Update: {
          actor?: string | null
          actor_type?: string
          created_at?: string
          from_status?: string
          id?: string
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
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
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          store_id: string
          user_agent: string | null
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          store_id: string
          user_agent?: string | null
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          store_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
          notify_sound_muted: boolean
          opens_at: string | null
          orders_last_seen_at: string | null
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
          notify_sound_muted?: boolean
          opens_at?: string | null
          orders_last_seen_at?: string | null
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
          notify_sound_muted?: boolean
          opens_at?: string | null
          orders_last_seen_at?: string | null
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
      auth_merchant_id: { Args: never; Returns: string[] }
      auth_store_ids: { Args: never; Returns: string[] }
      checkout_create_order: {
        Args: {
          p_cart_lines: Json
          p_customer_name: string
          p_customer_phone?: string
          p_pickup_slot_id: string
          p_store_slug: string
        }
        Returns: Json
      }
      console_confirm_payment: {
        Args: { p_merchant_id: string; p_order_id: string }
        Returns: Json
      }
      console_reject_payment: { Args: { p_order_id: string }; Returns: Json }
      create_payment_charge: {
        Args: { p_order_code: string; p_qr_payload: string }
        Returns: {
          amount_satang: number
          expires_at: string
          id: string
          order_id: string
          status: string
        }[]
      }
      enqueue_generate_slots_job: {
        Args: { p_store_id: string }
        Returns: undefined
      }
      generate_pickup_slots_for_store: {
        Args: {
          p_days_ahead?: number
          p_interval_minutes?: number
          p_store_id: string
        }
        Returns: number
      }
      public_order_lookup: {
        Args: { p_order_code: string; p_phone: string }
        Returns: {
          item_name: string
          order_code: string
          pickup_at: string
          quantity: number
          status: string
        }[]
      }
      public_order_status: {
        Args: { p_order_code: string }
        Returns: {
          item_name: string
          order_code: string
          pickup_at: string
          quantity: number
          status: string
        }[]
      }
      record_auth_attempt_if_allowed: {
        Args: { p_column: string; p_hash: string; p_max_per_hour: number }
        Returns: boolean
      }
      record_order_lookup_attempt_if_allowed: {
        Args: { p_column: string; p_hash: string; p_max_per_hour: number }
        Returns: boolean
      }
      release_pickup_slot: {
        Args: { p_slot_id: string }
        Returns: {
          booked_count: number
          capacity: number
          id: string
        }[]
      }
      reserve_pickup_slot: {
        Args: { p_slot_id: string }
        Returns: {
          booked_count: number
          capacity: number
          id: string
        }[]
      }
      transition_order: {
        Args: {
          p_actor: string
          p_actor_type: string
          p_order_id: string
          p_to: string
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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

