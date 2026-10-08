// Small in-memory rate limiter for the sign-in endpoints (one server process, no extra packages).
//
// Off when NODE_ENV is 'test' (the unit and e2e suites sign in constantly) unless
// CLOCKWIZE_RATE_LIMIT=on; CLOCKWIZE_RATE_LIMIT=off turns it off anywhere. Both are read on every
// request, so a test can switch it on for itself.
const isEnabled = () => {
  const flag = process.env.CLOCKWIZE_RATE_LIMIT;
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  return process.env.NODE_ENV !== 'test';
};

export const RATE_LIMIT_MESSAGE = 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.';

// key(req) names the bucket (e.g. IP + email). With failuresOnly, only responses with status >= 400
// count and a successful one clears the bucket - a user who signs in fine is never locked out.
export function createRateLimiter({ max = 10, windowMs = 15 * 60 * 1000, key = (req) => req.ip, failuresOnly = false } = {}) {
  const buckets = new Map();

  const sweep = (now) => {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
  };

  const limiter = (req, res, next) => {
    if (!isEnabled()) return next();

    const now = Date.now();
    if (buckets.size > 10_000) sweep(now);
    const k = String(key(req));
    let bucket = buckets.get(k);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(k, bucket);
    }

    if (bucket.count >= max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    if (!failuresOnly) {
      bucket.count += 1;
    } else {
      res.on('finish', () => {
        if (res.statusCode >= 400) bucket.count += 1;
        else buckets.delete(k);
      });
    }
    next();
  };

  limiter.reset = () => buckets.clear();
  return limiter;
}

// "ip|identifier" - the identifier lower-cased so "Dana@x" and "dana@x" share a bucket
export const ipAnd = (identifier) => (req) => `${req.ip}|${String(identifier(req) ?? '').trim().toLowerCase()}`;
