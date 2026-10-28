export interface ReminderPreset { id: string; label: string; at: number | null }

function at(base: Date, addDays: number, hour: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** The choices shown in the overlay and popup. `now` is injectable so tests are deterministic. */
export function reminderPresets(now = new Date()): ReminderPreset[] {
  const nextMonday = (() => {
    const d = new Date(now);
    const add = ((8 - d.getDay()) % 7) || 7;
    return at(d, add, 9);
  })();
  return [
    { id: 'none', label: 'No reminder', at: null },
    { id: '1h', label: 'In 1 hour', at: now.getTime() + 3_600_000 },
    { id: 'tonight', label: 'This evening (8 pm)', at: now.getHours() < 20 ? at(now, 0, 20) : at(now, 1, 20) },
    { id: 'tomorrow', label: 'Tomorrow morning (9 am)', at: at(now, 1, 9) },
    { id: '3d', label: 'In 3 days', at: at(now, 3, 9) },
    { id: 'week', label: 'Next Monday (9 am)', at: nextMonday },
  ];
}
