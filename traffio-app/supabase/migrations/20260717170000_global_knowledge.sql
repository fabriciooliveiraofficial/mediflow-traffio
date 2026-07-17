-- Fase 3: conhecimento odontologico global. Entrega para aplicacao pelo orquestrador.
begin;

create table if not exists public.global_knowledge (
    id uuid primary key default gen_random_uuid(),
    topic_key text not null,
    language text not null check (language in ('pt-BR', 'en', 'es')),
    category text not null,
    title text not null,
    content text not null,
    is_active boolean not null default true,
    guardrails jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint global_knowledge_content_length check (char_length(content) <= 2000),
    constraint global_knowledge_topic_language_unique unique (topic_key, language)
);

create index if not exists global_knowledge_language_active_idx on public.global_knowledge (language, is_active);
alter table public.global_knowledge enable row level security;
drop policy if exists "Authenticated users can read global knowledge" on public.global_knowledge;
drop policy if exists "Super admins can manage global knowledge" on public.global_knowledge;
create policy "Authenticated users can read global knowledge" on public.global_knowledge
    for select to authenticated using (true);
create policy "Super admins can manage global knowledge" on public.global_knowledge
    for all to authenticated
    using ((select p.role from public.profiles p where p.id = auth.uid()) = 'super_admin')
    with check ((select p.role from public.profiles p where p.id = auth.uid()) = 'super_admin');
grant select on public.global_knowledge to authenticated;
grant all on public.global_knowledge to service_role;

-- Seed curado: cada topico tem uma linha por idioma. Conteudo informativo, sem preco ou promessa.
insert into public.global_knowledge (topic_key, language, category, title, content, guardrails) values
('implant_overview','pt-BR','procedures','Implante dentario','O implante dentario e um suporte, geralmente de titanio, colocado no osso para substituir a raiz de um dente ausente. Depois da avaliacao clinica e dos exames indicados, o dentista define se essa opcao e adequada e explica as etapas do plano.','{"informative":true,"no_price":true}'),
('implant_overview','en','procedures','Dental implants','A dental implant is a support, commonly made of titanium, placed in the jawbone to replace the root of a missing tooth. After a clinical assessment and any indicated exams, the dentist decides whether it is suitable and explains the treatment plan.','{"informative":true,"no_price":true}'),
('implant_overview','es','procedures','Implantes dentales','Un implante dental es un soporte, generalmente de titanio, colocado en el hueso para reemplazar la raiz de un diente ausente. Tras la evaluacion clinica y los estudios indicados, el dentista define si es adecuado y explica las etapas del plan.','{"informative":true,"no_price":true}'),
('teeth_whitening','pt-BR','procedures','Clareamento dental','O clareamento dental usa substancias que podem reduzir manchas e alterar a tonalidade dos dentes. O dentista avalia a causa das manchas, a saude bucal e a tecnica indicada antes de definir o plano.','{"informative":true,"no_price":true}'),
('teeth_whitening','en','procedures','Teeth whitening','Teeth whitening uses substances that may reduce stains and change tooth shade. The dentist assesses the cause of discoloration, oral health, and suitable technique before defining a plan.','{"informative":true,"no_price":true}'),
('teeth_whitening','es','procedures','Blanqueamiento dental','El blanqueamiento dental usa sustancias que pueden reducir manchas y cambiar el tono de los dientes. El dentista evalua la causa de las manchas, la salud bucal y la tecnica indicada antes de definir el plan.','{"informative":true,"no_price":true}'),
('root_canal','pt-BR','procedures','Tratamento de canal','O tratamento de canal remove o tecido inflamado ou infectado dentro do dente e depois sela o espaco tratado. A necessidade e as etapas dependem dos achados clinicos e dos exames avaliados pelo dentista.','{"informative":true,"no_price":true}'),
('root_canal','en','procedures','Root canal treatment','Root canal treatment removes inflamed or infected tissue inside a tooth and seals the treated space. The need and steps depend on clinical findings and exams reviewed by the dentist.','{"informative":true,"no_price":true}'),
('root_canal','es','procedures','Tratamiento de conducto','El tratamiento de conducto retira el tejido inflamado o infectado dentro del diente y sella el espacio tratado. La necesidad y las etapas dependen de los hallazgos clinicos y de los estudios revisados por el dentista.','{"informative":true,"no_price":true}'),
('clear_aligners','pt-BR','procedures','Alinhadores transparentes','Alinhadores transparentes sao placas removiveis que aplicam forcas graduais para movimentar os dentes. O dentista avalia a mordida, os tecidos e os objetivos do caso para definir se essa abordagem e indicada.','{"informative":true,"no_price":true}'),
('clear_aligners','en','procedures','Clear aligners','Clear aligners are removable trays that apply gradual forces to move teeth. The dentist assesses the bite, tissues, and goals of the case to decide whether this approach is indicated.','{"informative":true,"no_price":true}'),
('clear_aligners','es','procedures','Alineadores transparentes','Los alineadores transparentes son placas removibles que aplican fuerzas graduales para mover los dientes. El dentista evalua la mordida, los tejidos y los objetivos del caso para definir si este enfoque esta indicado.','{"informative":true,"no_price":true}'),
('dental_cleaning_prophylaxis','pt-BR','prevention','Limpeza dental','A limpeza profissional remove placa e calculo que a escovacao pode nao alcançar. A frequencia e os cuidados recomendados dependem da avaliacao da gengiva, dos dentes e dos habitos de cada pessoa.','{"informative":true,"no_price":true}'),
('dental_cleaning_prophylaxis','en','prevention','Dental cleaning','Professional cleaning removes plaque and calculus that brushing may not reach. Recommended frequency and care depend on an assessment of the gums, teeth, and each person habits.','{"informative":true,"no_price":true}'),
('dental_cleaning_prophylaxis','es','prevention','Limpieza dental','La limpieza profesional retira placa y calculo que el cepillado puede no alcanzar. La frecuencia y los cuidados recomendados dependen de la evaluacion de las encias, los dientes y los habitos de cada persona.','{"informative":true,"no_price":true}'),
('veneers','pt-BR','procedures','Facetas dentarias','Facetas sao laminas finas colocadas na parte visivel do dente para mudar forma ou cor em situacoes selecionadas. A avaliacao verifica estrutura dental, mordida e alternativas antes de indicar o procedimento.','{"informative":true,"no_price":true}'),
('veneers','en','procedures','Dental veneers','Veneers are thin layers placed on the visible part of a tooth to change shape or color in selected situations. Assessment checks tooth structure, bite, and alternatives before the procedure is indicated.','{"informative":true,"no_price":true}'),
('veneers','es','procedures','Carillas dentales','Las carillas son laminas finas colocadas en la parte visible del diente para cambiar forma o color en situaciones seleccionadas. La evaluacion revisa la estructura dental, la mordida y las alternativas antes de indicarlas.','{"informative":true,"no_price":true}'),
('tooth_extraction','pt-BR','procedures','Extracao dentaria','A extracao remove um dente quando a avaliacao indica que essa e a conduta mais apropriada. O dentista examina o dente e o contexto de saude para orientar riscos, cuidados e alternativas.','{"informative":true,"no_price":true}'),
('tooth_extraction','en','procedures','Tooth extraction','An extraction removes a tooth when assessment indicates it is the appropriate course. The dentist examines the tooth and health context to discuss risks, care, and alternatives.','{"informative":true,"no_price":true}'),
('tooth_extraction','es','procedures','Extraccion dental','La extraccion retira un diente cuando la evaluacion indica que es la conducta adecuada. El dentista examina el diente y el contexto de salud para orientar sobre riesgos, cuidados y alternativas.','{"informative":true,"no_price":true}'),
('post_op_general','pt-BR','care','Cuidados apos procedimento','Os cuidados apos um procedimento variam conforme a tecnica e a resposta de cada pessoa. Siga as orientacoes escritas do dentista e procure a clinica se surgirem sinais ou duvidas que ele tenha orientado observar.','{"informative":true,"no_price":true}'),
('post_op_general','en','care','Aftercare','Aftercare varies according to the technique and each person response. Follow the dentist written instructions and contact the clinic if signs or questions arise that the dentist advised you to observe.','{"informative":true,"no_price":true}'),
('post_op_general','es','care','Cuidados posteriores','Los cuidados posteriores varian segun la tecnica y la respuesta de cada persona. Siga las indicaciones escritas del dentista y contacte a la clinica si aparecen señales o dudas que le haya indicado observar.','{"informative":true,"no_price":true}'),
('first_consultation_general','pt-BR','general','Primeira consulta','A primeira consulta costuma incluir conversa sobre a queixa, historico de saude, exame e explicacao dos proximos passos. O dentista define quais exames e qual plano fazem sentido para aquele caso.','{"informative":true,"no_price":true}'),
('first_consultation_general','en','general','First consultation','A first consultation commonly includes a discussion of the concern, health history, examination, and explanation of next steps. The dentist decides which exams and plan make sense for that case.','{"informative":true,"no_price":true}'),
('first_consultation_general','es','general','Primera consulta','La primera consulta suele incluir conversacion sobre el motivo, historial de salud, examen y explicacion de los proximos pasos. El dentista define que estudios y plan tienen sentido para cada caso.','{"informative":true,"no_price":true}'),
('dental_anxiety_general','pt-BR','general','Medo de dentista','Falar sobre ansiedade ajuda a equipe a adaptar a comunicacao e o ritmo do atendimento. O dentista pode explicar opcoes de cuidado e avaliar o que e apropriado para cada pessoa.','{"informative":true,"no_price":true}'),
('dental_anxiety_general','en','general','Dental anxiety','Sharing anxiety can help the team adapt communication and the pace of care. The dentist can explain care options and assess what is appropriate for each person.','{"informative":true,"no_price":true}'),
('dental_anxiety_general','es','general','Ansiedad dental','Hablar sobre la ansiedad ayuda al equipo a adaptar la comunicacion y el ritmo de la atencion. El dentista puede explicar opciones de cuidado y evaluar lo apropiado para cada persona.','{"informative":true,"no_price":true}'),
('gum_disease_periodontitis','pt-BR','conditions','Doenca gengival','A doenca gengival pode envolver inflamacao dos tecidos que sustentam os dentes, com sinais como sangramento ou alteracao de volume. O exame periodontal define a gravidade e os cuidados indicados pelo dentista.','{"informative":true,"no_price":true}'),
('gum_disease_periodontitis','en','conditions','Gum disease','Gum disease can involve inflammation of the tissues supporting the teeth, with signs such as bleeding or swelling. A periodontal exam determines severity and care recommended by the dentist.','{"informative":true,"no_price":true}'),
('gum_disease_periodontitis','es','conditions','Enfermedad de las encias','La enfermedad de las encias puede implicar inflamacion de los tejidos que sostienen los dientes, con señales como sangrado o aumento de volumen. El examen periodontal define la gravedad y los cuidados indicados por el dentista.','{"informative":true,"no_price":true}'),
('crowns_bridges','pt-BR','procedures','Coroas e pontes','Coroas podem recobrir um dente danificado, e pontes podem substituir um ou mais dentes apoiando-se em dentes ou estruturas planejadas. A avaliacao da estrutura, mordida e alternativas orienta a indicacao.','{"informative":true,"no_price":true}'),
('crowns_bridges','en','procedures','Crowns and bridges','Crowns can cover a damaged tooth, while bridges may replace one or more teeth using planned supports. Assessment of structure, bite, and alternatives guides the indication.','{"informative":true,"no_price":true}'),
('crowns_bridges','es','procedures','Coronas y puentes','Las coronas pueden cubrir un diente dañado y los puentes pueden reemplazar uno o mas dientes con apoyos planificados. La evaluacion de la estructura, la mordida y las alternativas orienta la indicacion.','{"informative":true,"no_price":true}'),
('cavities_fillings','pt-BR','conditions','Carie e restauracao','A carie e uma alteracao do dente que pode ser tratada com remocao do tecido comprometido e restauracao, quando indicado. O dentista avalia profundidade, sintomas e estrutura para escolher a conduta.','{"informative":true,"no_price":true}'),
('cavities_fillings','en','conditions','Cavities and fillings','A cavity is a tooth change that may be treated by removing affected tissue and placing a filling when indicated. The dentist assesses depth, symptoms, and structure to choose the approach.','{"informative":true,"no_price":true}'),
('cavities_fillings','es','conditions','Caries y restauraciones','La caries es un cambio en el diente que puede tratarse retirando el tejido afectado y colocando una restauracion cuando se indique. El dentista evalua profundidad, sintomas y estructura para elegir la conducta.','{"informative":true,"no_price":true}'),
('pediatric_dentistry_general','pt-BR','general','Odontopediatria','A odontopediatria acompanha crescimento, higiene, dentes e habitos da crianca. A abordagem e a frequencia das consultas dependem da idade, do desenvolvimento e da avaliacao profissional.','{"informative":true,"no_price":true}'),
('pediatric_dentistry_general','en','general','Pediatric dentistry','Pediatric dentistry follows a child growth, hygiene, teeth, and habits. The approach and visit frequency depend on age, development, and professional assessment.','{"informative":true,"no_price":true}'),
('pediatric_dentistry_general','es','general','Odontopediatria','La odontopediatria acompaña el crecimiento, la higiene, los dientes y los habitos del niño. El enfoque y la frecuencia de las consultas dependen de la edad, el desarrollo y la evaluacion profesional.','{"informative":true,"no_price":true}'),
('emergency_guidance_general','pt-BR','safety','Orientacao para emergencia','Em caso de sangramento intenso, trauma importante, inchaço que dificulte respirar ou engolir, ou dor intensa, procure atendimento odontologico ou medico imediato. Nao tente diagnosticar ou medicar-se por esta mensagem; a equipe avaliara a situacao.','{"informative":true,"no_price":true,"no_diagnosis":true}'),
('emergency_guidance_general','en','safety','Emergency guidance','For heavy bleeding, significant trauma, swelling that makes breathing or swallowing difficult, or severe pain, seek immediate dental or medical care. Do not diagnose or self-medicate from this message; a clinician will assess the situation.','{"informative":true,"no_price":true,"no_diagnosis":true}'),
('emergency_guidance_general','es','safety','Orientacion para emergencias','Ante sangrado intenso, trauma importante, hinchazon que dificulte respirar o tragar, o dolor intenso, busque atencion odontologica o medica inmediata. No intente diagnosticar ni automedicarse por este mensaje; un profesional evaluara la situacion.','{"informative":true,"no_price":true,"no_diagnosis":true}');

commit;
