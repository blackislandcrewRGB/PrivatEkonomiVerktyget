import { useEffect, useState } from "react";
import { getJson, type BankStatus } from "../../api";
import { HeaderActions } from "../../shell/PageHeader";
import { openSettings } from "../../shell/routes";
import { expiringConsent, hoursText, nextSync } from "./nextSync";

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "long" });

/**
 * Importer's header, on the right: when the banks are synced and the next
 * run ('Banksynk kl 06, 12 och 18 · nästa i dag 18:00'), or, when a bank
 * consent runs out within 30 days, that in orange with a link to renew it.
 * Nothing without a bank connection.
 */
export function ImportsHeader() {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    getJson<BankStatus>("/enable-banking/status").then(setStatus, () => setStatus(null));
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const active = status?.configured ? status.connections.filter((c) => c.status === "active" || c.status === "expired") : [];
  if (active.length === 0) return null;
  const expiring = expiringConsent(active);
  const next = nextSync(now, status!.syncHours ?? []);

  return (
    <HeaderActions>
      {expiring ? (
        <p className="text-[12px] font-medium text-caution-text" data-header="consent">
          Bankkopplingen {expiring.status === "expired" || (expiring.daysLeft ?? 0) < 0 ? "gick ut" : "går ut"} {longDate(expiring.validUntil!)} ·{" "}
          <button
            type="button"
            onClick={() => {
              openSettings("konton");
            }}
            className="font-semibold underline-offset-2 hover:underline"
          >
            förnya
          </button>
        </p>
      ) : (
        next && (
          <p className="text-[12px] text-ink-3" data-header="next-sync">
            Banksynk {hoursText(status!.syncHours)} · nästa {next.day} {next.time}
          </p>
        )
      )}
    </HeaderActions>
  );
}
