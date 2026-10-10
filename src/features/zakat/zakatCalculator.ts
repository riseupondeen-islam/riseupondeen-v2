/* Zakat calculation rules — unchanged from the original calculator:
   total = cash + gold + silver + investments + business − liabilities (never below 0)
   due   = 2.5% of total, only when a Nisab value is entered and total ≥ Nisab. */

export type ZakatField = 'cash' | 'gold' | 'silver' | 'investments' | 'business' | 'liabilities' | 'nisab';
export type ZakatInputs = Record<ZakatField, string>;
export type NisabBasis = 'gold' | 'silver';

export const ZAKAT_CURRENCIES = ['INR', 'SAR', 'AED', 'USD', 'GBP', 'EUR'] as const;
export const NISAB_BASIS_LABELS: Record<NisabBasis, string> = {
  gold: 'Gold Nisab · 20 dinars',
  silver: 'Silver Nisab · 200 dirhams',
};

export const EMPTY_ZAKAT_INPUTS: ZakatInputs = {
  cash: '',
  gold: '',
  silver: '',
  investments: '',
  business: '',
  liabilities: '',
  nisab: '',
};

/** Parses an input value the same way as before: blank, negative or invalid → 0. */
export function zakatAmount(raw: string | null | undefined): number {
  const value = String(raw ?? '').trim();
  const n = value === '' ? 0 : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function formatZakat(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export interface ZakatResult {
  total: number;
  nisab: number;
  due: number;
  status: string;
}

export function calculateZakat(inputs: ZakatInputs): ZakatResult {
  const a = (k: ZakatField) => zakatAmount(inputs[k]);
  const total = Math.max(0, a('cash') + a('gold') + a('silver') + a('investments') + a('business') - a('liabilities'));
  const nisab = a('nisab');
  const due = nisab > 0 && total >= nisab ? total * 0.025 : 0;
  const status = !nisab
    ? 'Enter the current Nisab value'
    : total >= nisab
      ? 'Nisab reached'
      : 'Below the entered Nisab';
  return { total, nisab, due, status };
}
