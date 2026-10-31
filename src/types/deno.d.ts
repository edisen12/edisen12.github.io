// Declarações ambientais de tipos para funções Edge Deno consumidas em testes TypeScript
declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
  [key: string]: any;
};
