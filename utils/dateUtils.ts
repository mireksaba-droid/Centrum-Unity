export const formatLocalDate = (dateStr: string, options?: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('cs-CZ', options);
};

export const parseLocalDate = (dateStr: string, timeStr?: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
  }
  return new Date(y, m - 1, d);
};
