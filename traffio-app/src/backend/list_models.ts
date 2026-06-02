import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function listGeminiModels() {
    const supabaseurl = process.env.VITE_SUPABASE_URL;
    const supabasekey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseurl || !supabasekey) {
        console.error("❌ Erro: Credenciais do Supabase não encontradas.");
        return;
    }

    const supabase = createClient(supabaseurl, supabasekey);
    const { data: configs, error } = await supabase.from('master_config').select('*').eq('key', 'GEMINI_API_KEY').single();

    if (error || !configs?.value) {
        console.error("❌ Erro: GEMINI_API_KEY não encontrada no banco.");
        return;
    }

    const apiKey = configs.value;
    console.log(`🔑 Testando chave...`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            console.log("\n✅ Modelos Disponíveis:");
            data.models.forEach((m: any) => {
                if (m.name.includes('flash')) console.log(`- ${m.name}`);
            });
        } else {
            console.error("❌ Erro ao listar modelos:", JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error("🔥 Erro de rede:", e);
    }
}

listGeminiModels();
