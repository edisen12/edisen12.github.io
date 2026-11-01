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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      apontamentos_hh: {
        Row: {
          data: string
          horas_executadas: number
          id: string
          matricula: string
          plataforma_sigla: string | null
          unidade_negocio: string
          updated_at: string
        }
        Insert: {
          data: string
          horas_executadas: number
          id?: string
          matricula: string
          plataforma_sigla?: string | null
          unidade_negocio?: string
          updated_at?: string
        }
        Update: {
          data?: string
          horas_executadas?: number
          id?: string
          matricula?: string
          plataforma_sigla?: string | null
          unidade_negocio?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apontamentos_hh_matricula_fkey"
            columns: ["matricula"]
            isOneToOne: false
            referencedRelation: "tecnicos"
            referencedColumns: ["matricula"]
          },
          {
            foreignKeyName: "apontamentos_hh_plataforma_sigla_fkey"
            columns: ["plataforma_sigla"]
            isOneToOne: false
            referencedRelation: "plataformas"
            referencedColumns: ["sigla"]
          },
        ]
      }
      carteira_embarques: {
        Row: {
          data_fim: string
          data_inicio: string
          ex: number | null
          fonte: string
          horas_programadas: number | null
          id: string
          matricula: string
          operacao: string
          pe: number | null
          plataforma_sigla: string | null
          unidade_negocio: string
          updated_at: string
        }
        Insert: {
          data_fim: string
          data_inicio: string
          ex?: number | null
          fonte?: string
          horas_programadas?: number | null
          id?: string
          matricula: string
          operacao?: string
          pe?: number | null
          plataforma_sigla?: string | null
          unidade_negocio?: string
          updated_at?: string
        }
        Update: {
          data_fim?: string
          data_inicio?: string
          ex?: number | null
          fonte?: string
          horas_programadas?: number | null
          id?: string
          matricula?: string
          operacao?: string
          pe?: number | null
          plataforma_sigla?: string | null
          unidade_negocio?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carteira_embarques_matricula_fkey"
            columns: ["matricula"]
            isOneToOne: false
            referencedRelation: "tecnicos"
            referencedColumns: ["matricula"]
          },
          {
            foreignKeyName: "carteira_embarques_plataforma_sigla_fkey"
            columns: ["plataforma_sigla"]
            isOneToOne: false
            referencedRelation: "plataformas"
            referencedColumns: ["sigla"]
          },
        ]
      }
      config_usoff_un: {
        Row: {
          ex: number | null
          pe: number | null
          unidade_negocio: string
          updated_at: string
        }
        Insert: {
          ex?: number | null
          pe?: number | null
          unidade_negocio: string
          updated_at?: string
        }
        Update: {
          ex?: number | null
          pe?: number | null
          unidade_negocio?: string
          updated_at?: string
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          atencao_percentual: number
          dia_corte_medicao: number
          dias_embarque: number
          hh_dia: number
          id: string
          med_criterio: string
          meta_percentual: number
          prazo_justificativa_dias: number
          regionais_extras: Json
          slogan: string
          updated_at: string
          us_ex_padrao: number | null
          us_pe_padrao: number | null
        }
        Insert: {
          atencao_percentual?: number
          dia_corte_medicao?: number
          dias_embarque?: number
          hh_dia?: number
          id?: string
          med_criterio?: string
          meta_percentual?: number
          prazo_justificativa_dias?: number
          regionais_extras?: Json
          slogan?: string
          updated_at?: string
          us_ex_padrao?: number | null
          us_pe_padrao?: number | null
        }
        Update: {
          atencao_percentual?: number
          dia_corte_medicao?: number
          dias_embarque?: number
          hh_dia?: number
          id?: string
          med_criterio?: string
          meta_percentual?: number
          prazo_justificativa_dias?: number
          regionais_extras?: Json
          slogan?: string
          updated_at?: string
          us_ex_padrao?: number | null
          us_pe_padrao?: number | null
        }
        Relationships: []
      }
      configuracoes_notificacao: {
        Row: {
          emails_resumo: Json
          id: string
          updated_at: string
        }
        Insert: {
          emails_resumo?: Json
          id?: string
          updated_at?: string
        }
        Update: {
          emails_resumo?: Json
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fluxo_importacoes: {
        Row: {
          criado_em: string
          data_maxima: string | null
          id: string
          observacao: string
          origem: string
          tipo_fluxo: string
          total_linhas: number
          usuario_id: string | null
        }
        Insert: {
          criado_em?: string
          data_maxima?: string | null
          id?: string
          observacao?: string
          origem?: string
          tipo_fluxo: string
          total_linhas?: number
          usuario_id?: string | null
        }
        Update: {
          criado_em?: string
          data_maxima?: string | null
          id?: string
          observacao?: string
          origem?: string
          tipo_fluxo?: string
          total_linhas?: number
          usuario_id?: string | null
        }
        Relationships: []
      }
      justificativas: {
        Row: {
          criado_em: string
          criado_por: string | null
          data: string
          descricao: string
          horas_gangway: number
          id: string
          matricula: string
          motivo: string
          responsavel_nome: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          data: string
          descricao?: string
          horas_gangway?: number
          id?: string
          matricula: string
          motivo: string
          responsavel_nome: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          data?: string
          descricao?: string
          horas_gangway?: number
          id?: string
          matricula?: string
          motivo?: string
          responsavel_nome?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "justificativas_matricula_fkey"
            columns: ["matricula"]
            isOneToOne: false
            referencedRelation: "tecnicos"
            referencedColumns: ["matricula"]
          },
        ]
      }
      justificativas_audit_log: {
        Row: {
          audit_id: string
          data: string
          descricao_antiga: string | null
          descricao_nova: string | null
          horas_antigas: number | null
          horas_novas: number | null
          justificativa_id: string | null
          matricula: string
          modificado_em: string
          modificado_por: string | null
          motivo_antigo: string | null
          motivo_novo: string | null
          operacao: string
        }
        Insert: {
          audit_id?: string
          data: string
          descricao_antiga?: string | null
          descricao_nova?: string | null
          horas_antigas?: number | null
          horas_novas?: number | null
          justificativa_id?: string | null
          matricula: string
          modificado_em?: string
          modificado_por?: string | null
          motivo_antigo?: string | null
          motivo_novo?: string | null
          operacao: string
        }
        Update: {
          audit_id?: string
          data?: string
          descricao_antiga?: string | null
          descricao_nova?: string | null
          horas_antigas?: number | null
          horas_novas?: number | null
          justificativa_id?: string | null
          matricula?: string
          modificado_em?: string
          modificado_por?: string | null
          motivo_antigo?: string | null
          motivo_novo?: string | null
          operacao?: string
        }
        Relationships: []
      }
      pessoa_plataformas: {
        Row: {
          pessoa_id: string
          plataforma_sigla: string
        }
        Insert: {
          pessoa_id: string
          plataforma_sigla: string
        }
        Update: {
          pessoa_id?: string
          plataforma_sigla?: string
        }
        Relationships: [
          {
            foreignKeyName: "pessoa_plataformas_pessoa_id_fkey"
            columns: ["pessoa_id"]
            isOneToOne: false
            referencedRelation: "pessoas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pessoa_plataformas_plataforma_sigla_fkey"
            columns: ["plataforma_sigla"]
            isOneToOne: false
            referencedRelation: "plataformas"
            referencedColumns: ["sigla"]
          },
        ]
      }
      pessoa_unidades: {
        Row: {
          pessoa_id: string
          unidade_negocio: string
        }
        Insert: {
          pessoa_id: string
          unidade_negocio: string
        }
        Update: {
          pessoa_id?: string
          unidade_negocio?: string
        }
        Relationships: [
          {
            foreignKeyName: "pessoa_unidades_pessoa_id_fkey"
            columns: ["pessoa_id"]
            isOneToOne: false
            referencedRelation: "pessoas"
            referencedColumns: ["id"]
          },
        ]
      }
      pessoas: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
          papel: string
          slug: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          nome: string
          papel?: string
          slug: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
          papel?: string
          slug?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      plataformas: {
        Row: {
          armador: string
          cadastro_pendente: boolean
          chave_norm: string
          gerencia: string
          nome: string
          sigla: string
          situacao: string
          tipo: string
          un: string
          updated_at: string
        }
        Insert: {
          armador?: string
          cadastro_pendente?: boolean
          chave_norm: string
          gerencia?: string
          nome: string
          sigla: string
          situacao?: string
          tipo?: string
          un?: string
          updated_at?: string
        }
        Update: {
          armador?: string
          cadastro_pendente?: boolean
          chave_norm?: string
          gerencia?: string
          nome?: string
          sigla?: string
          situacao?: string
          tipo?: string
          un?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ativo: boolean
          created_at: string
          email: string
          id: string
          nome: string
          role: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email: string
          id: string
          nome: string
          role?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string
          id?: string
          nome?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_heartbeat: {
        Row: {
          id: number
          updated_at: string
        }
        Insert: {
          id?: number
          updated_at?: string
        }
        Update: {
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      system_audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_nome: string | null
          actor_role: string | null
          category: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string | null
          target_label: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_nome?: string | null
          actor_role?: string | null
          category: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_label?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_nome?: string | null
          actor_role?: string | null
          category?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_label?: string | null
        }
        Relationships: []
      }
      tecnicos: {
        Row: {
          funcao: string
          matricula: string
          nome: string
          updated_at: string
        }
        Insert: {
          funcao?: string
          matricula: string
          nome: string
          updated_at?: string
        }
        Update: {
          funcao?: string
          matricula?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          created_at: string
          obriga_troca_senha: boolean
          preferencias: Json
          primeiro_login: boolean
          senha_trocada_em: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          obriga_troca_senha?: boolean
          preferencias?: Json
          primeiro_login?: boolean
          senha_trocada_em?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          obriga_troca_senha?: boolean
          preferencias?: Json
          primeiro_login?: boolean
          senha_trocada_em?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_allowed_platforms: { Args: never; Returns: string[] }
      auth_allowed_uns: { Args: never; Returns: string[] }
      auth_can_access_justificativa: {
        Args: { p_data: string; p_mat: string }
        Returns: boolean
      }
      auth_is_active: { Args: never; Returns: boolean }
      auth_is_admin: { Args: never; Returns: boolean }
      auth_is_global: { Args: never; Returns: boolean }
      auth_is_unlocked: { Args: never; Returns: boolean }
      complete_first_login_password_change: { Args: never; Returns: undefined }
      fn_get_current_actor_context: {
        Args: never
        Returns: {
          actor_email: string
          actor_id: string
          actor_nome: string
          actor_role: string
          ip_address: string
        }[]
      }
      get_external_covered_days: {
        Args: { p_fim: string; p_ini: string }
        Returns: {
          data: string
          matricula: string
        }[]
      }
      get_shared_ops: { Args: { p_ops: string[] }; Returns: string[] }
      get_watermark_status: {
        Args: never
        Returns: {
          ultima_data_hh: string
          ultima_importacao_em: string
        }[]
      }
      log_system_event: {
        Args: {
          p_action: string
          p_category: string
          p_details?: Json
          p_target_id?: string
          p_target_label?: string
        }
        Returns: string
      }
      ping_health: { Args: never; Returns: string }
      update_own_profile: {
        Args: { p_nome: string; p_preferencias?: Json }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

