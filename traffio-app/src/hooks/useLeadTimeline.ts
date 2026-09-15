import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../lib/i18n/formatCurrency';

export type CrmTimelineEventType =
  | 'journey_created' | 'stage_changed' | 'appointment_created' | 'appointment_confirmed'
  | 'checked_in' | 'appointment_completed' | 'no_show' | 'appointment_cancelled'
  | 'message_received' | 'message_sent' | 'sale_recorded' | 'note_added'
  | 'automation_fired' | 'automation_stopped'
  | 'appointment_rescheduled' | 'sync_blocked'
  | 'proposal_sent' | 'proposal_approved' | 'proposal_lost';

export interface CrmTimelineEvent {
  id: string;
  type: CrmTimelineEventType;
  date: string;
  title: string;
  subtitle: string | null;
  actor: string;
  payload: any;
}

const TITLE_KEYS: Record<CrmTimelineEventType, string> = {
  journey_created:        'timeline.events.leadEntered',
  stage_changed:          'timeline.events.stageChanged',
  appointment_created:    'timeline.events.appointmentCreated',
  appointment_confirmed:  'timeline.events.appointmentConfirmedEvent',
  checked_in:              'timeline.events.checkedIn',
  appointment_completed:   'timeline.events.appointmentCompleted',
  no_show:                 'timeline.events.appointmentNoShow',
  appointment_cancelled:   'timeline.events.appointmentCanceled',
  message_received:        'timeline.events.messageReceived',
  message_sent:            'timeline.events.messageSent',
  sale_recorded:           'timeline.events.saleRecorded',
  note_added:               'timeline.events.noteAdded',
  automation_fired:         'timeline.events.automationFired',
  automation_stopped:       'timeline.events.automationStopped',
  appointment_rescheduled:  'timeline.events.appointmentRescheduled',
  sync_blocked:             'timeline.events.syncBlocked',
  proposal_sent:            'timeline.events.proposalSent',
  proposal_approved:        'timeline.events.proposalApproved',
  proposal_lost:            'timeline.events.proposalLost',
};

const STAGE_KEYS: Record<string, string> = {
  new_lead: 'stages.newLead', in_contact: 'stages.inContact', scheduled: 'stages.scheduled',
  showed_up: 'stages.showedUp', proposal: 'stages.proposal', recovery: 'stages.recovery',
  recall_due: 'stages.recallDue', won: 'stages.won', lost: 'stages.lost',
};

export function useLeadTimeline(journeyId: string | null, tenantId: string | undefined) {
  const { t } = useTranslation('crm');
  const [events, setEvents] = useState<CrmTimelineEvent[]>([]);
  const [pendingAppointments, setPendingAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTimeline = useCallback(async () => {
    if (!journeyId || !tenantId) return;

    try {
      setLoading(true);

      const { data: rawEvents } = await supabase
        .from('crm_journey_events')
        .select('*')
        .eq('journey_id', journeyId)
        .order('created_at', { ascending: false });

      const mapped: CrmTimelineEvent[] = (rawEvents || []).map(e => ({
        id: e.id,
        type: e.event_type,
        date: e.created_at,
        title: t(TITLE_KEYS[e.event_type as CrmTimelineEventType] || 'timeline.events.genericEvent'),
        subtitle: e.event_type === 'appointment_rescheduled'
          ? `${e.payload?.from} → ${e.payload?.to}`
          : e.event_type === 'sync_blocked'
            ? t('timeline.events.syncBlockedDetail', { stage: t(STAGE_KEYS[e.payload?.to] || 'timeline.events.genericEvent') })
            : e.payload?.total != null
              ? [e.payload?.preview, formatCurrency(Number(e.payload.total))].filter(Boolean).join(' · ')
              : e.payload?.preview || e.payload?.template_key || null,
        actor: e.actor,
        payload: e.payload,
      }));

      setEvents(mapped);

      // Agendamentos passados sem resultado registrado (para os botões de ação rápida)
      const { data: journey } = await supabase
        .from('crm_journeys')
        .select('patient_id')
        .eq('id', journeyId)
        .maybeSingle();

      if (journey?.patient_id) {
        const today = new Date().toISOString().split('T')[0];
        const { data: appts } = await supabase
          .from('appointments')
          .select('id, date, start_time, status, notes, type:appointment_types(name)')
          .eq('tenant_id', tenantId)
          .eq('patient_id', journey.patient_id)
          .in('status', ['scheduled', 'confirmed', 'waiting'])
          .lte('date', today);
        setPendingAppointments(appts || []);
      } else {
        setPendingAppointments([]);
      }
    } catch (error) {
      console.error('[LeadTimeline] Error fetching timeline:', error);
    } finally {
      setLoading(false);
    }
  }, [journeyId, tenantId, t]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  return { events, pendingAppointments, loading, refresh: fetchTimeline };
}
