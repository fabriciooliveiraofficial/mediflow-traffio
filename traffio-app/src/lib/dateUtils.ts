/**
 * Utility to format dates from the database (YYYY-MM-DD) to display format (DD/MM/YYYY)
 * without timezone shifts.
 */
export const formatDisplayDate = (dbDate: string | null | undefined): string => {
    if (!dbDate) return '';
    
    // In case of full ISO string, take only the date part
    const datePart = dbDate.split('T')[0];
    const parts = datePart.split('-');
    
    if (parts.length !== 3) return dbDate;
    
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
};
