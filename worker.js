const PERIODS = [
  { path: "last-week", label: "weekly" },
  { path: "last-month", label: "monthly" },
];

const INTERVALS = ["daily", "weekly"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function requireVar(env, key) {
  const value = (env[key] ?? "").trim();

  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}

function optionalVar(env, key, fallback) {
  return (env[key] ?? "").trim() || fallback;
}

function packageNames(env) {
  const names = requireVar(env, "PACKAGE_NAMES")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) {
    throw new Error("PACKAGE_NAMES lists no package");
  }

  return names;
}

function notifyHour(env) {
  const hour = Number(optionalVar(env, "NOTIFY_HOUR", "10"));

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(
      `NOTIFY_HOUR must be an integer 0-23, got "${env.NOTIFY_HOUR}"`,
    );
  }

  return hour;
}

function notifyInterval(env) {
  const interval = optionalVar(env, "NOTIFY_INTERVAL", "daily").toLowerCase();

  if (!INTERVALS.includes(interval)) {
    throw new Error(
      `NOTIFY_INTERVAL must be ${INTERVALS.join(" or ")}, got "${interval}"`,
    );
  }

  return interval;
}

// Only consulted when NOTIFY_INTERVAL is weekly; accepts "mon" or "monday"
function notifyWeekday(env) {
  const name = optionalVar(env, "NOTIFY_WEEKDAY", "mon")
    .toLowerCase()
    .slice(0, 3);
  const index = WEEKDAYS.indexOf(name);

  if (index === -1) {
    throw new Error(
      `NOTIFY_WEEKDAY must be one of ${WEEKDAYS.join(", ")}, got "${env.NOTIFY_WEEKDAY}"`,
    );
  }

  return index;
}

function timezone(env) {
  const zone = optionalVar(env, "TIMEZONE", "UTC");

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    throw new Error(`TIMEZONE is not a valid IANA timezone: "${zone}"`);
  }

  return zone;
}

// Resolved up front so a bad config fails before any network call
function config(env) {
  return {
    packages: packageNames(env),
    timezone: timezone(env),
    hour: notifyHour(env),
    interval: notifyInterval(env),
    weekday: notifyWeekday(env),
    webhookUrl: requireVar(env, "DISCORD_WEBHOOK_URL"),
  };
}

// Cron fires hourly in UTC; the schedule below is expressed in the configured timezone
function currentHour(timeZone) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
}

function currentWeekday(timeZone) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(new Date())
    .toLowerCase();

  return WEEKDAYS.indexOf(name);
}

function isDue(cfg) {
  if (currentHour(cfg.timezone) !== cfg.hour) {
    return false;
  }

  return (
    cfg.interval === "daily" || currentWeekday(cfg.timezone) === cfg.weekday
  );
}

function reportDate(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchDownloads(name, period) {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/${period.path}/${name}`,
    { headers: { accept: "application/json" } },
  );

  if (!res.ok) {
    throw new Error(
      `npm API failed for ${name} ${period.path}: ${res.status} ${res.statusText}`,
    );
  }

  const { downloads } = await res.json();
  return { ...period, downloads };
}

async function fetchPackage(name) {
  const stats = await Promise.all(
    PERIODS.map((period) => fetchDownloads(name, period)),
  );
  return { name, stats };
}

async function notify(cfg) {
  const packages = await Promise.all(cfg.packages.map(fetchPackage));
  const content = [
    `📈 npm downloads · ${reportDate(cfg.timezone)}`,
    ...packages.map(
      ({ name, stats }) =>
        `📦 ${name} — ${stats
          .map((s) => `${s.downloads.toLocaleString("en-US")} ${s.label}`)
          .join(" · ")}`,
    ),
  ].join("\n");

  const hookRes = await fetch(cfg.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!hookRes.ok) {
    throw new Error(
      `Discord webhook failed: ${hookRes.status} ${await hookRes.text()}`,
    );
  }

  return content;
}

export default {
  async fetch(request, env) {
    // Browsers also request /favicon.ico, which would fire a second notify
    const { pathname } = new URL(request.url);
    if (pathname !== "/") {
      return new Response("not found", { status: 404 });
    }

    try {
      const content = await notify(config(env));
      return new Response(`ok\n\n${content}`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    } catch (err) {
      return new Response(`error: ${err.message}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },

  async scheduled(_event, env, ctx) {
    const cfg = config(env);

    if (!isDue(cfg)) {
      return;
    }

    ctx.waitUntil(notify(cfg));
  },
};
