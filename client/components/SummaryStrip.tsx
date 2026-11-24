import { formatRupiah, type DebtSummary } from '../api';

interface SummaryStripProps {
  summary: DebtSummary;
}

export function SummaryStrip({ summary }: SummaryStripProps) {
  const isPositive = summary.netBalanceIdr >= 0;
  const netLabel =
    summary.netBalanceIdr > 0
      ? 'Posisi piutang lebih besar dari tagihan Anda'
      : summary.netBalanceIdr < 0
        ? 'Anda memiliki sisa tagihan yang perlu dilunasi'
        : 'Saldo utang dan piutang Anda seimbang';

  return (
    <section id="ringkasan" class="summary-strip" aria-labelledby="summary-heading">
      <div class="summary-primary">
        <h1 id="summary-heading" class="summary-label">
          Saldo Bersih Aktif
        </h1>
        <p
          class={`summary-net-amount tabular-num ${
            summary.netBalanceIdr > 0
              ? 'is-credit'
              : summary.netBalanceIdr < 0
                ? 'is-debt'
                : ''
          }`}
        >
          {isPositive && summary.netBalanceIdr > 0 ? '+' : ''}
          {formatRupiah(summary.netBalanceIdr)}
        </p>
        <p class="metric-sub">{netLabel}</p>
      </div>

      <div class="summary-metrics">
        <div class="metric-block">
          <span class="summary-label">Tagihan Harus Anda Bayar</span>
          <span class="metric-value tabular-num">{formatRupiah(summary.totalPayableIdr)}</span>
          <span class="metric-sub">
            {summary.activeBillCount} tagihan aktif tercatat ke akun Anda
          </span>
        </div>

        <div class="metric-block">
          <span class="summary-label">Piutang Orang Lain ke Anda</span>
          <span class="metric-value tabular-num">{formatRupiah(summary.totalReceivableIdr)}</span>
          <span class="metric-sub">
            {summary.pendingConfirmationCount > 0
              ? `${summary.pendingConfirmationCount} pembayaran menunggu konfirmasi Anda`
              : 'Belum ada klaim pembayaran yang tertunda'}
          </span>
        </div>
      </div>
    </section>
  );
}
