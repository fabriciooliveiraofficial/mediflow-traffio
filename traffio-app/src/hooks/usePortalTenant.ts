import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function usePortalTenant() {
    const { slug } = useParams<{ slug: string }>();
    const [tenant, setTenant] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchTenant() {
            if (!slug) {
                setError('No slug provided');
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('tenants')
                    .select('*')
                    .eq('slug', slug)
                    .single();

                if (error) throw error;
                setTenant(data);
            } catch (err: any) {
                console.error('Error fetching tenant:', err);
                setError(err.message || 'Tenant not found');
            } finally {
                setLoading(false);
            }
        }

        fetchTenant();
    }, [slug]);

    return { tenant, loading, error, slug };
}
