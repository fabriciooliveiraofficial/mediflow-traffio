-- Consulta todos os vínculos doctor_services com nomes legíveis
SELECT
    ds.id AS vinculo_id,
    d.full_name AS profissional,
    d.specialty AS especialidade,
    at.name AS servico,
    at.duration_minutes AS duracao_min,
    at.price_cents AS preco_centavos,
    l.name AS local_atendimento,
    at.is_active AS servico_ativo,
    ds.created_at
FROM doctor_services ds
JOIN doctors d ON d.id = ds.doctor_id
JOIN appointment_types at ON at.id = ds.service_id
LEFT JOIN locations l ON l.id = ds.location_id
ORDER BY d.full_name, at.name;
