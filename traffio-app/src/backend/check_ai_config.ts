import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function checkConfig() {
    const supabaseurl = process.env.VITE_SUPABASE_URL;
    const supabasekey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseurl || !supabasekey) {
        console.error("❌ Erro: Credenciais do Supabase não encontradas no .env.local");
        return;
    }

    const supabase = createClient(supabaseurl, supabasekey);

    console.log("🔍 Verificando tabela master_config...");
    const { data: configs, error } = await supabase.from('master_config').select('*');

    if (error) {
        console.error("❌ Erro ao ler master_config:", error.message);
        return;
    }

    const geminiKey = configs?.find(c => c.key === 'GEMINI_API_KEY');
    const globalEnabled = configs?.find(c => c.key === 'AI_GLOBAL_ENABLED');

    if (!geminiKey || !geminiKey.value) {
        console.warn("⚠️ ALERTA: GEMINI_API_KEY está vazia ou faltando!");
    } else {
        console.log("✅ GEMINI_API_KEY encontrada (Tamanho:", geminiKey.value.length, "caracteres)");
    }

    if (globalEnabled?.value !== 'true') {
        console.warn("⚠️ ALERTA: AI_GLOBAL_ENABLED não está 'true'. O robô pode estar desativado.");
    } else {
        console.log("✅ AI_GLOBAL_ENABLED está ativo.");
    }
}

checkConfig();
