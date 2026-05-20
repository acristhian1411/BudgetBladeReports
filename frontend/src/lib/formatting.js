/**
 * Format number as currency (USD)
 */
export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date) {
  if (typeof date === 'string') {
    return date; // Already formatted
  }

  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  return date.toISOString().split('T')[0];
}

/**
 * Format date for display
 */
export function formatDateDisplay(date) {
  if (typeof date === 'string') {
    date = new Date(date);
  }

  if (!(date instanceof Date)) {
    return '';
  }

  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format time for display
 */
export function formatTime(date) {
  if (typeof date === 'string') {
    date = new Date(date);
  }

  if (!(date instanceof Date)) {
    return '';
  }

  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
