module.exports = async ({ call, record, ADMIN, ctx, backendDir }) => {
  const health = await call("GET", "/health/ready");
  record("health ready", health.status === 200, `status ${health.status}, ${health.ms}ms`);
  ctx.publicReadyHasDetails = JSON.stringify(health.json).includes("\"details\"");
  record("public readiness hides check details", !ctx.publicReadyHasDetails);

  const tours = await call("GET", "/tours?page=1&limit=10");
  const items = tours.json?.data || [];
  record("tour list (Bokun mock sync)", tours.ok && items.length > 0, `${items.length} tours, ${tours.ms}ms`);
  ctx.tour = items[0];

  const detail = await call("GET", `/tours/${ctx.tour.slug}`);
  record("tour detail", detail.ok, `${detail.ms}ms`);
  const detailRepeat = await call("GET", `/tours/${ctx.tour.slug}`);
  record("tour detail repeat", detailRepeat.ok, `${detailRepeat.ms}ms`);
  ctx.detail = detail.json?.data;

  const login = await call("POST", "/auth/login", { body: ADMIN });
  ctx.token = login.json?.data?.token;
  record("admin login", login.ok && Boolean(ctx.token), `status ${login.status}`);
  const badLogin = await call("POST", "/auth/login", { body: { email: ADMIN.email, password: "wrong-password-1" } });
  record("bad password rejected", badLogin.status === 401 || badLogin.status === 400, `status ${badLogin.status}`);
  const me = await call("GET", "/auth/me", { token: ctx.token });
  record("auth me", me.ok, `role ${me.json?.data?.role || me.json?.data?.user?.role}`);
  await require("./steps-booking.js")({ call, record, ctx });
  await require("./steps-admin.js")({ call, record, ctx, ADMIN, backendDir });
};
