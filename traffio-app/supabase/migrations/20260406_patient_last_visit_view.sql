-- View to get patients with their last visit date calculated from appointments
create or replace view public.vw_patients_with_last_visit as
with last_appointments as (
  select 
    patient_id,
    max(start_time) as last_visit
  from 
    public.appointments
  where 
    start_time <= now()
    and status not in ('cancelled', 'cancelled_by_patient', 'no_show', 'noshow')
  group by 
    patient_id
)
select 
  p.*,
  la.last_visit
from 
  public.patients p
left join 
  last_appointments la on p.id = la.patient_id;

-- Grant access to authenticated users
grant select on public.vw_patients_with_last_visit to authenticated;
grant select on public.vw_patients_with_last_visit to anon;
grant select on public.vw_patients_with_last_visit to service_role;
