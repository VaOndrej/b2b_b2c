import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import type {
  NotificationPage,
  NotificationRule,
  NotificationSurface,
  NotificationType,
} from "@won/core/toasts/notifications";
import {
  NOTIFICATION_PAGES,
  sanitizeNotifications,
} from "@won/core/toasts/notifications";
import type { NotificationSchedule } from "@won/core/toasts/scheduling";
import { sanitizeSchedule } from "@won/core/toasts/scheduling";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { useSavedToast } from "../lib/use-saved-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

const SURFACES: NotificationSurface[] = [
  "toast",
  "banner",
  "persistent-toast",
  "inline",
];

// Scoped pages a merchant can pick (drop the internal "all"; empty = all).
const PICKABLE_PAGES: NotificationPage[] = NOTIFICATION_PAGES.filter(
  (p) => p !== "all",
);

function readPages(form: FormData, type: NotificationType): NotificationPage[] {
  return PICKABLE_PAGES.filter((p) => form.get(`${type}_page_${p}`) === "on");
}

const DOW = [
  { i: 0, label: "Sun" },
  { i: 1, label: "Mon" },
  { i: 2, label: "Tue" },
  { i: 3, label: "Wed" },
  { i: 4, label: "Thu" },
  { i: 5, label: "Fri" },
  { i: 6, label: "Sat" },
];

function readSchedule(
  form: FormData,
  type: NotificationType,
): NotificationSchedule | undefined {
  const days = DOW.map((d) => d.i).filter(
    (i) => form.get(`${type}_sch_day_${i}`) === "on",
  );
  const from = form.get(`${type}_sch_hour_from`);
  const to = form.get(`${type}_sch_hour_to`);
  const useHours = String(from ?? "") !== "" || String(to ?? "") !== "";
  return sanitizeSchedule({
    startsAt: String(form.get(`${type}_sch_start`) ?? "").trim() || undefined,
    endsAt: String(form.get(`${type}_sch_end`) ?? "").trim() || undefined,
    daysOfWeek: days,
    hours: useHours ? [Number(from) || 0, Number(to) || 0] : undefined,
  });
}

function buildRule(
  form: FormData,
  type: NotificationType,
): NotificationRule | null {
  const enabled = form.get(`${type}_enabled`) === "on";
  const surface =
    (form.get(`${type}_surface`) as NotificationSurface) ?? "toast";
  const pages = readPages(form, type);
  const message = String(form.get(`${type}_message`) ?? "");
  const schedule = readSchedule(form, type);
  const sched = schedule ? { schedule } : {};

  if (type === "countdown") {
    const mode = form.get("countdown_mode");
    const base = { id: "countdown", type, enabled, surface, pages, message, ...sched };
    if (mode === "evergreen") {
      const hours = Number(form.get("countdown_evergreen_hours")) || 0;
      return { ...base, evergreenMs: Math.round(hours * 3_600_000) };
    }
    const endsAt = String(form.get("countdown_ends_at") ?? "").trim();
    return { ...base, endsAt: endsAt || undefined };
  }
  if (type === "stock.low") {
    return {
      id: "stock.low",
      type,
      enabled,
      surface,
      pages,
      message,
      ...sched,
      threshold: Number(form.get("stock.low_threshold")) || 1,
    };
  }
  if (type === "announcement") {
    const messages: Record<string, string> = {};
    for (const loc of ["cs", "sk", "en"]) {
      const v = String(form.get(`announcement_msg_${loc}`) ?? "").trim();
      if (v) messages[loc] = v;
    }
    const variants = String(form.get("announcement_variants") ?? "")
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    return {
      id: "announcement",
      type,
      enabled,
      surface,
      pages,
      message,
      ...sched,
      ...(Object.keys(messages).length ? { messages } : {}),
      ...(variants.length ? { variants } : {}),
    };
  }
  if (type === "order.summary") {
    return {
      id: "order.summary",
      type,
      enabled,
      surface,
      pages,
      message,
      ...sched,
      windowHours: Number(form.get("order.summary_window_hours")) || 168,
    };
  }
  if (type === "order.created") {
    return {
      id: "order.created",
      type,
      enabled,
      surface,
      pages,
      message,
      ...sched,
      showName: form.get("order.created_show_name") === "on",
      showCity: form.get("order.created_show_city") === "on",
      minOrders: Number(form.get("order.created_min_orders")) || 5,
    };
  }
  return {
    id: "cart.activity",
    type,
    enabled,
    surface,
    pages,
    message,
    ...sched,
    windowHours: Number(form.get("cart.activity_window_hours")) || 24,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const isPro = config.plan === "pro";
  const form = await request.formData();

  const rules: NotificationRule[] = [];
  // Free types are always rebuilt from the form; Pro types keep their existing
  // config on Free (so upgrading restores them) and are rewritten only on Pro.
  for (const type of ["countdown", "announcement"] as NotificationType[]) {
    const r = buildRule(form, type);
    if (r) rules.push(r);
  }

  for (const type of [
    "stock.low",
    "cart.activity",
    "order.summary",
    "order.created",
  ] as NotificationType[]) {
    if (isPro) {
      const r = buildRule(form, type);
      if (r) rules.push(r);
    } else {
      const existing = config.notifications.find((n) => n.type === type);
      if (existing) rules.push(existing);
    }
  }

  await updateToastConfig(session.shop, {
    notifications: sanitizeNotifications(rules),
  });
  return { saved: true };
};

function ruleOf(config: { notifications: NotificationRule[] }, type: NotificationType) {
  return config.notifications.find((n) => n.type === type);
}

function PagePicker({ type, pages }: { type: NotificationType; pages: NotificationPage[] }) {
  return (
    <s-stack direction="block" gap="small">
      <s-text type="strong">Pages (none = all pages)</s-text>
      <s-stack direction="inline" gap="base">
        {PICKABLE_PAGES.map((p) => (
          <s-checkbox
            key={p}
            label={p}
            name={`${type}_page_${p}`}
            value="on"
            checked={pages.includes(p)}
          />
        ))}
      </s-stack>
    </s-stack>
  );
}

function ScheduleFields({
  type,
  schedule,
}: {
  type: NotificationType;
  schedule?: NotificationSchedule;
}) {
  const s = schedule ?? {};
  return (
    <s-stack direction="block" gap="small">
      <s-text type="strong">Schedule (optional)</s-text>
      <s-paragraph>
        Leave blank to always run. Evaluated in your shop’s timezone.
      </s-paragraph>
      <s-stack direction="inline" gap="base">
        <s-text-field
          label="Start (ISO)"
          name={`${type}_sch_start`}
          value={s.startsAt ?? ""}
          placeholder="2026-11-24T00:00:00Z"
        />
        <s-text-field
          label="End (ISO)"
          name={`${type}_sch_end`}
          value={s.endsAt ?? ""}
          placeholder="2026-11-30T23:59:59Z"
        />
      </s-stack>
      <s-stack direction="block" gap="small">
        <s-text type="strong">Days of week (none = all)</s-text>
        <s-stack direction="inline" gap="base">
          {DOW.map((d) => (
            <s-checkbox
              key={d.i}
              label={d.label}
              name={`${type}_sch_day_${d.i}`}
              value="on"
              checked={(s.daysOfWeek ?? []).includes(d.i)}
            />
          ))}
        </s-stack>
      </s-stack>
      <s-stack direction="inline" gap="base">
        <s-number-field
          label="Hour from (0–23)"
          name={`${type}_sch_hour_from`}
          value={s.hours ? String(s.hours[0]) : ""}
          min={0}
          max={23}
        />
        <s-number-field
          label="Hour to (0–23)"
          name={`${type}_sch_hour_to`}
          value={s.hours ? String(s.hours[1]) : ""}
          min={0}
          max={23}
        />
      </s-stack>
    </s-stack>
  );
}

function SurfaceSelect({ type, value }: { type: NotificationType; value: NotificationSurface }) {
  return (
    <s-select label="Surface" name={`${type}_surface`} value={value}>
      {SURFACES.map((s) => (
        <s-option key={s} value={s}>
          {s}
        </s-option>
      ))}
    </s-select>
  );
}

export default function RecipesRoute() {
  const { config } = useLoaderData<typeof loader>();
  useSavedToast();
  const isPro = config.plan === "pro";

  const countdown = ruleOf(config, "countdown") as
    | Extract<NotificationRule, { type: "countdown" }>
    | undefined;
  const stock = ruleOf(config, "stock.low") as
    | Extract<NotificationRule, { type: "stock.low" }>
    | undefined;
  const activity = ruleOf(config, "cart.activity") as
    | Extract<NotificationRule, { type: "cart.activity" }>
    | undefined;
  const announcement = ruleOf(config, "announcement") as
    | Extract<NotificationRule, { type: "announcement" }>
    | undefined;
  const orderSummary = ruleOf(config, "order.summary") as
    | Extract<NotificationRule, { type: "order.summary" }>
    | undefined;
  const social = ruleOf(config, "order.created") as
    | Extract<NotificationRule, { type: "order.created" }>
    | undefined;

  const evergreenHours = countdown?.evergreenMs
    ? String(countdown.evergreenMs / 3_600_000)
    : "24";

  return (
    <s-page heading="Recipes">
      <s-section>
        <s-paragraph>
          Notifications that run on the page itself — a countdown, a low-stock
          nudge, live cart activity. Every one uses <s-text type="strong">real
          data</s-text> and obeys your frequency &amp; quiet-mode settings.
        </s-paragraph>
      </s-section>

      <Form method="post" data-save-bar>
        {/* ---- Countdown (Free) ---- */}
        <s-section heading="Countdown timer">
          <s-stack direction="block" gap="base">
            <s-badge tone="success">Free</s-badge>
            <s-switch
              label="Enable countdown"
              name="countdown_enabled"
              checked={countdown?.enabled ?? false}
            />
            <s-paragraph>
              A truthful sale/deadline timer. Use a fixed end date, or an
              evergreen per-visitor window.
            </s-paragraph>
            <s-select
              label="Countdown mode"
              name="countdown_mode"
              value={countdown?.endsAt ? "fixed" : "evergreen"}
            >
              <s-option value="fixed">Fixed end date</s-option>
              <s-option value="evergreen">Evergreen (per visitor)</s-option>
            </s-select>
            <s-text-field
              label="Ends at (ISO 8601, e.g. 2026-12-31T23:59:59Z)"
              name="countdown_ends_at"
              value={countdown?.endsAt ?? ""}
              placeholder="2026-12-31T23:59:59Z"
            />
            <s-number-field
              label="Evergreen window (hours)"
              name="countdown_evergreen_hours"
              value={evergreenHours}
              min={1}
            />
            <SurfaceSelect type="countdown" value={countdown?.surface ?? "banner"} />
            <s-text-field
              label="Message ({countdown} = time left)"
              name="countdown_message"
              value={countdown?.message ?? "Sale ends in {countdown}"}
            />
            <PagePicker type="countdown" pages={countdown?.pages ?? []} />
            <ScheduleFields type="countdown" schedule={countdown?.schedule} />
          </s-stack>
        </s-section>

        {/* ---- Low stock (Pro) ---- */}
        <s-section heading="Low-stock urgency">
          <s-stack direction="block" gap="base">
            <s-badge tone={isPro ? "success" : "info"}>
              {isPro ? "Pro" : "Pro — upgrade to enable"}
            </s-badge>
            <s-switch
              label="Enable low-stock"
              name="stock.low_enabled"
              checked={stock?.enabled ?? false}
              disabled={!isPro}
            />
            <s-paragraph>
              Shows “Only N left” only when the real inventory is below your
              threshold. Out of stock never shouts.
            </s-paragraph>
            <s-number-field
              label="Threshold (show when inventory is below)"
              name="stock.low_threshold"
              value={String(stock?.threshold ?? 5)}
              min={1}
              disabled={!isPro}
            />
            <SurfaceSelect type="stock.low" value={stock?.surface ?? "inline"} />
            <s-text-field
              label="Message ({count} = units left)"
              name="stock.low_message"
              value={stock?.message ?? "Only {count} left"}
              disabled={!isPro}
            />
            <PagePicker type="stock.low" pages={stock?.pages ?? ["product"]} />
            <ScheduleFields type="stock.low" schedule={stock?.schedule} />
          </s-stack>
        </s-section>

        {/* ---- Cart activity (Pro) ---- */}
        <s-section heading="Cart activity">
          <s-stack direction="block" gap="base">
            <s-badge tone={isPro ? "success" : "info"}>
              {isPro ? "Pro" : "Pro — upgrade to enable"}
            </s-badge>
            <s-switch
              label="Enable cart activity"
              name="cart.activity_enabled"
              checked={activity?.enabled ?? false}
              disabled={!isPro}
            />
            <s-paragraph>
              “{"{count}"} people added this recently” — a real, server-side
              counter. Never a fabricated number.
            </s-paragraph>
            <s-number-field
              label="Aggregation window (hours)"
              name="cart.activity_window_hours"
              value={String(activity?.windowHours ?? 24)}
              min={1}
              disabled={!isPro}
            />
            <SurfaceSelect type="cart.activity" value={activity?.surface ?? "toast"} />
            <s-text-field
              label="Message ({count} = people)"
              name="cart.activity_message"
              value={activity?.message ?? "{count} people added this recently"}
              disabled={!isPro}
            />
            <PagePicker type="cart.activity" pages={activity?.pages ?? ["product"]} />
            <ScheduleFields type="cart.activity" schedule={activity?.schedule} />
          </s-stack>
        </s-section>

        {/* ---- Announcement (Free) ---- */}
        <s-section heading="Announcement">
          <s-stack direction="block" gap="base">
            <s-badge tone="success">Free</s-badge>
            <s-switch
              label="Enable announcement"
              name="announcement_enabled"
              checked={announcement?.enabled ?? false}
            />
            <s-paragraph>
              Your own message — a sale, a shipping cutoff, a notice. Schedule it
              below and localize per language.
            </s-paragraph>
            <SurfaceSelect type="announcement" value={announcement?.surface ?? "banner"} />
            <s-text-field
              label="Message (default / fallback)"
              name="announcement_message"
              value={announcement?.message ?? ""}
              placeholder="Free gift on orders over 1000 Kč this week!"
            />
            <s-text-field
              label="Czech (cs)"
              name="announcement_msg_cs"
              value={announcement?.messages?.cs ?? ""}
            />
            <s-text-field
              label="Slovak (sk)"
              name="announcement_msg_sk"
              value={announcement?.messages?.sk ?? ""}
            />
            <s-text-field
              label="English (en)"
              name="announcement_msg_en"
              value={announcement?.messages?.en ?? ""}
            />
            <s-text-area
              label="A/B variants (one per line; splits shoppers evenly)"
              name="announcement_variants"
              rows={3}
              value={(announcement?.variants ?? []).join("\n")}
              placeholder={"Free gift over 1000 Kč!\nSpend 1000 Kč, get a gift 🎁"}
            />
            <PagePicker type="announcement" pages={announcement?.pages ?? []} />
            <ScheduleFields type="announcement" schedule={announcement?.schedule} />
          </s-stack>
        </s-section>

        {/* ---- Order summary aggregate (Pro) ---- */}
        <s-section heading="Order summary">
          <s-stack direction="block" gap="base">
            <s-badge tone={isPro ? "success" : "info"}>
              {isPro ? "Pro" : "Pro — upgrade to enable"}
            </s-badge>
            <s-switch
              label="Enable order summary"
              name="order.summary_enabled"
              checked={orderSummary?.enabled ?? false}
              disabled={!isPro}
            />
            <s-paragraph>
              “{"{count}"} orders in the last week” — counted from your real
              orders. Shows nothing until there are orders in the window.
            </s-paragraph>
            <s-number-field
              label="Window (hours; e.g. 168 = 7 days)"
              name="order.summary_window_hours"
              value={String(orderSummary?.windowHours ?? 168)}
              min={1}
              max={720}
              disabled={!isPro}
            />
            <SurfaceSelect type="order.summary" value={orderSummary?.surface ?? "toast"} />
            <s-text-field
              label="Message ({count} = orders)"
              name="order.summary_message"
              value={orderSummary?.message ?? "{count} orders this week"}
              disabled={!isPro}
            />
            <PagePicker type="order.summary" pages={orderSummary?.pages ?? []} />
            <ScheduleFields type="order.summary" schedule={orderSummary?.schedule} />
          </s-stack>
        </s-section>

        {/* ---- Social proof / recent sales (Pro) ---- */}
        <s-section heading="Recent sales (social proof)">
          <s-stack direction="block" gap="base">
            <s-badge tone={isPro ? "success" : "info"}>
              {isPro ? "Pro" : "Pro — upgrade to enable"}
            </s-badge>
            <s-switch
              label="Enable recent sales"
              name="order.created_enabled"
              checked={social?.enabled ?? false}
              disabled={!isPro}
            />
            <s-paragraph>
              “Anna from Praha bought a Mug” — built from{" "}
              <s-text type="strong">real orders only</s-text>, storing just a
              first name + city. It stays off until you have enough orders, and
              never invents a sale. Shoppers can opt out per order with a{" "}
              <s-text type="strong">won_social_optout</s-text> order note.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-checkbox
                label="Show first name"
                name="order.created_show_name"
                value="on"
                checked={social?.showName ?? true}
                disabled={!isPro}
              />
              <s-checkbox
                label="Show city"
                name="order.created_show_city"
                value="on"
                checked={social?.showCity ?? true}
                disabled={!isPro}
              />
            </s-stack>
            <s-number-field
              label="Minimum real orders before it turns on"
              name="order.created_min_orders"
              value={String(social?.minOrders ?? 5)}
              min={1}
              disabled={!isPro}
            />
            <SurfaceSelect type="order.created" value={social?.surface ?? "toast"} />
            <s-text-field
              label="Message ({name}, {city}, {product}, {time})"
              name="order.created_message"
              value={social?.message ?? "{name} from {city} bought {product}"}
              disabled={!isPro}
            />
            <PagePicker type="order.created" pages={social?.pages ?? []} />
            <ScheduleFields type="order.created" schedule={social?.schedule} />
          </s-stack>
        </s-section>

        {!isPro ? (
          <s-section>
            <s-banner tone="info" heading="Low-stock and cart activity are Pro">
              <s-paragraph>
                <s-link href="/app/plan">Upgrade to Pro</s-link> to turn these on.
                Countdown is included on Free.
              </s-paragraph>
            </s-banner>
          </s-section>
        ) : null}
      </Form>
    </s-page>
  );
}
