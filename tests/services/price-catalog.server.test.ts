import test from "node:test";
import assert from "node:assert/strict";
import {
  createPriceCatalog,
  updatePriceCatalog,
  deletePriceCatalog,
  listPriceCatalogs,
  upsertCatalogPriceRule,
  upsertCatalogFloorRule,
  upsertCatalogDiscountRule,
  upsertCatalogQuantityRule,
  addCatalogMembership,
  upsertCatalogVariantVisibilityRule,
  resolveStorefrontCatalogVariantVisibility,
  upsertCatalogVisibilityRule,
  resolveStorefrontCatalogProductVisibility,
  loadCatalogCollectionVisibility,
  upsertCatalogCouponRule,
  setCatalogDiscountCap,
  upsertCatalogBlacklistRule,
  upsertCatalogCustomerQuantityRule,
  type PriceCatalogClient,
} from "../../app/services/price-catalog.server.ts";
import { handleCatalogsSettingsAction } from "../../app/services/catalogs-settings.server.ts";

// In-memory fake of the Prisma surface the repository touches (dependency
// injection — no dev.sqlite mutation), mirroring tests/services/*.server.test.ts.
function makeFakeClient(): PriceCatalogClient & {
  _state: {
    catalogs: Map<string, any>;
    tags: any[];
    filters: any[];
    priceRules: any[];
    floorRules: any[];
    tierPrices: any[];
    discountRules: any[];
    quantityRules: any[];
    memberships: any[];
    variantVisibility: any[];
    visibility: any[];
    coupons: any[];
    caps: any[];
    blacklist: any[];
    customerQuantity: any[];
  };
} {
  const catalogs = new Map<string, any>();
  const tags: any[] = [];
  const filters: any[] = [];
  const priceRules: any[] = [];
  const floorRules: any[] = [];
  const tierPrices: any[] = [];
  const discountRules: any[] = [];
  const quantityRules: any[] = [];
  const memberships: any[] = [];
  const variantVisibility: any[] = [];
  const visibility: any[] = [];
  const coupons: any[] = [];
  const caps: any[] = [];
  const blacklist: any[] = [];
  const customerQuantity: any[] = [];
  let seq = 0;
  const nextId = () => `id-${++seq}`;
  const makeDelegate = (store: any[]) => ({
    async create({ data }: any) {
      const row = { id: nextId(), ...data };
      store.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = store.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    async delete({ where }: any) {
      const i = store.findIndex((r) => r.id === where.id);
      if (i >= 0) store.splice(i, 1);
    },
    async deleteMany({ where }: any) {
      for (let i = store.length - 1; i >= 0; i--) {
        if (Object.entries(where ?? {}).every(([k, v]) => store[i][k] === v)) {
          store.splice(i, 1);
        }
      }
    },
  });
  return {
    _state: { catalogs, tags, filters, priceRules, floorRules, tierPrices, discountRules, quantityRules, memberships, variantVisibility, visibility, coupons, caps, blacklist, customerQuantity },
    catalogPriceRule: makeDelegate(priceRules),
    catalogFloorRule: makeDelegate(floorRules),
    catalogTierPriceRule: makeDelegate(tierPrices),
    catalogDiscountRule: makeDelegate(discountRules),
    catalogQuantityRule: makeDelegate(quantityRules),
    catalogMembership: makeDelegate(memberships),
    catalogVariantVisibilityRule: makeDelegate(variantVisibility),
    catalogVisibilityRule: makeDelegate(visibility),
    catalogCouponRule: makeDelegate(coupons),
    catalogDiscountCap: makeDelegate(caps),
    catalogDiscountBlacklistRule: makeDelegate(blacklist),
    catalogCustomerQuantityRule: makeDelegate(customerQuantity),
    priceCatalog: {
      async findMany() {
        return [...catalogs.values()].map((c) => ({
          ...c,
          audienceTags: tags.filter((t) => t.catalogId === c.id),
          marketFilters: filters.filter((f) => f.catalogId === c.id),
        }));
      },
      async findUnique({ where }: any) {
        return catalogs.get(where.id) ?? null;
      },
      async create({ data }: any) {
        const id = data.id ?? nextId();
        const catalog = {
          id,
          name: data.name,
          priority: data.priority ?? 0,
          status: data.status,
          isDefault: data.isDefault ?? false,
          isSystem: data.isSystem ?? false,
          matchCompany: data.matchCompany ?? false,
          membershipMode: data.membershipMode,
        };
        catalogs.set(id, catalog);
        for (const t of data.audienceTags?.create ?? []) {
          tags.push({ id: nextId(), catalogId: id, tag: t.tag });
        }
        for (const f of data.marketFilters?.create ?? []) {
          filters.push({ id: nextId(), catalogId: id, ...f });
        }
        return {
          ...catalog,
          audienceTags: tags.filter((t) => t.catalogId === id),
          marketFilters: filters.filter((f) => f.catalogId === id),
        };
      },
      async update({ where, data }: any) {
        const catalog = catalogs.get(where.id);
        Object.assign(catalog, data);
        return catalog;
      },
      async delete({ where }: any) {
        catalogs.delete(where.id);
      },
    },
    catalogAudienceTag: {
      async deleteMany({ where }: any) {
        for (let i = tags.length - 1; i >= 0; i--) {
          if (tags[i].catalogId === where.catalogId) tags.splice(i, 1);
        }
      },
      async create({ data }: any) {
        tags.push({ id: nextId(), ...data });
      },
    },
    catalogMarketFilter: {
      async deleteMany({ where }: any) {
        for (let i = filters.length - 1; i >= 0; i--) {
          if (filters[i].catalogId === where.catalogId) filters.splice(i, 1);
        }
      },
      async create({ data }: any) {
        filters.push({ id: nextId(), ...data });
      },
    },
  };
}

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

test("createPriceCatalog normalizes tags (lowercase/dedupe), floors priority, marks non-system", async () => {
  const client = makeFakeClient();
  const created = await createPriceCatalog(
    {
      name: "  Loyalty Gold  ",
      priority: 50.9,
      status: "ACTIVE",
      matchCompany: false,
      membershipMode: "OPT_IN",
      audienceTags: ["Gold", "gold", " VIP "],
      marketFilters: [{ countryCode: "cz", currencyCode: "czk", languageCode: null }],
    },
    client,
  );
  assert.equal(created.name, "Loyalty Gold");
  assert.equal(created.priority, 50);
  assert.equal(created.isSystem, false);
  assert.equal(created.isDefault, false);
  assert.deepEqual(created.audienceTags.map((t: any) => t.tag).sort(), ["gold", "vip"]);
  assert.deepEqual(created.marketFilters[0], {
    id: created.marketFilters[0].id,
    catalogId: created.id,
    countryCode: "CZ",
    currencyCode: "CZK",
    languageCode: null,
  });
});

test("createPriceCatalog rejects an empty name", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () =>
      createPriceCatalog(
        { name: "   ", priority: 0, status: "DRAFT", matchCompany: false, membershipMode: "OPT_IN", audienceTags: [], marketFilters: [] },
        client,
      ),
    /name is required/i,
  );
});

test("updatePriceCatalog replaces audience tags + market filters", async () => {
  const client = makeFakeClient();
  const created = await createPriceCatalog(
    { name: "Wholesale", priority: 10, status: "ACTIVE", matchCompany: true, membershipMode: "OPT_IN", audienceTags: ["wholesale"], marketFilters: [] },
    client,
  );
  await updatePriceCatalog(
    created.id,
    { name: "Wholesale EU", priority: 20, status: "ACTIVE", matchCompany: true, membershipMode: "INHERIT_ALL", audienceTags: ["eu-wholesale"], marketFilters: [{ countryCode: "DE", currencyCode: "EUR", languageCode: null }] },
    client,
  );
  assert.deepEqual(client._state.tags.filter((t) => t.catalogId === created.id).map((t) => t.tag), ["eu-wholesale"]);
  assert.equal(client._state.filters.filter((f) => f.catalogId === created.id).length, 1);
  assert.equal(client._state.catalogs.get(created.id).name, "Wholesale EU");
  assert.equal(client._state.catalogs.get(created.id).priority, 20);
});

test("updatePriceCatalog keeps a system catalog's priority/identity but allows name/status/audience", async () => {
  const client = makeFakeClient();
  client._state.catalogs.set("b2b", { id: "b2b", name: "B2B", priority: 100, status: "ACTIVE", isDefault: false, isSystem: true, matchCompany: true, membershipMode: "INHERIT_ALL" });
  await updatePriceCatalog(
    "b2b",
    { name: "Wholesale", priority: 5, status: "DRAFT", matchCompany: false, membershipMode: "OPT_IN", audienceTags: ["b2b", "trade"], marketFilters: [] },
    client,
  );
  const b2b = client._state.catalogs.get("b2b");
  assert.equal(b2b.name, "Wholesale");
  assert.equal(b2b.status, "DRAFT");
  assert.equal(b2b.priority, 100, "system catalog priority is immutable");
  assert.equal(b2b.matchCompany, true, "system catalog matchCompany is immutable");
  assert.deepEqual(client._state.tags.filter((t) => t.catalogId === "b2b").map((t) => t.tag).sort(), ["b2b", "trade"]);
});

test("deletePriceCatalog removes custom catalogs but refuses system catalogs", async () => {
  const client = makeFakeClient();
  const custom = await createPriceCatalog(
    { name: "Temp", priority: 1, status: "DRAFT", matchCompany: false, membershipMode: "OPT_IN", audienceTags: [], marketFilters: [] },
    client,
  );
  await deletePriceCatalog(custom.id, client);
  assert.equal(client._state.catalogs.has(custom.id), false);

  client._state.catalogs.set("default", { id: "default", name: "Default", priority: 0, isDefault: true, isSystem: true });
  await assert.rejects(() => deletePriceCatalog("default", client), /system catalog/i);
});

test("handleCatalogsSettingsAction dispatches save (create vs update) and delete via injected deps", async () => {
  const calls: string[] = [];
  const deps = {
    createPriceCatalog: (async (input: any) => {
      calls.push(`create:${input.name}`);
      return { id: "new" } as any;
    }) as any,
    updatePriceCatalog: (async (id: string) => {
      calls.push(`update:${id}`);
      return { id } as any;
    }) as any,
    deletePriceCatalog: (async (id: string) => {
      calls.push(`delete:${id}`);
    }) as any,
  };

  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog", name: "Gold", priority: "5", status: "ACTIVE", membershipMode: "OPT_IN", audienceTags: "gold" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog", catalogId: "cat-1", name: "Gold v2", priority: "5", status: "ACTIVE", membershipMode: "OPT_IN", audienceTags: "gold" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "delete-catalog", catalogId: "cat-1" }) }, deps);

  assert.deepEqual(calls, ["create:Gold", "update:cat-1", "delete:cat-1"]);
});

test("upsertCatalogPriceRule: CATALOG nulls the target; non-CATALOG requires one; create then update", async () => {
  const client = makeFakeClient();
  const catalogRule = await upsertCatalogPriceRule(
    { catalogId: "c1", scope: "CATALOG", targetId: "ignored", mode: "PERCENT", value: 90 },
    client,
  );
  assert.equal(catalogRule.targetId, null);
  assert.equal(catalogRule.value, 90);

  await assert.rejects(
    () => upsertCatalogPriceRule({ catalogId: "c1", scope: "PRODUCT", targetId: "", mode: "FIXED", value: 10 }, client),
    /needs a target id/i,
  );
  await assert.rejects(
    () => upsertCatalogPriceRule({ catalogId: "c1", scope: "CATALOG", mode: "PERCENT", value: -1 }, client),
    /non-negative/i,
  );

  const updated = await upsertCatalogPriceRule(
    { id: catalogRule.id, catalogId: "c1", scope: "CATALOG", mode: "PERCENT", value: 85 },
    client,
  );
  assert.equal(updated.value, 85);
  assert.equal(client._state.priceRules.length, 1);
});

test("upsertCatalogFloorRule clamps to 0..100", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () => upsertCatalogFloorRule({ catalogId: "c1", minPercentOfBasePrice: 120 }, client),
    /between 0 and 100/i,
  );
  const rule = await upsertCatalogFloorRule(
    { catalogId: "c1", productId: "p1", minPercentOfBasePrice: 70, allowZeroFinalPrice: true },
    client,
  );
  assert.equal(rule.minPercentOfBasePrice, 70);
  assert.equal(rule.allowZeroFinalPrice, true);
});

test("upsertCatalogDiscountRule validates percent + COUPON code requirement", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () => upsertCatalogDiscountRule({ catalogId: "c1", scope: "GLOBAL", percentOff: 0, priority: 100, stackMode: "STACKABLE" }, client),
    /between 0 and 100/i,
  );
  await assert.rejects(
    () => upsertCatalogDiscountRule({ catalogId: "c1", scope: "COUPON", code: "", percentOff: 10, priority: 100, stackMode: "STACKABLE" }, client),
    /needs a code/i,
  );
  const rule = await upsertCatalogDiscountRule(
    { catalogId: "c1", scope: "PRODUCT", targetId: "gid://shopify/Product/1", percentOff: 25, priority: 50, stackMode: "EXCLUSIVE", minPricePercentOfBasePrice: 70 },
    client,
  );
  assert.equal(rule.percentOff, 25);
  assert.equal(rule.stackMode, "EXCLUSIVE");
  assert.equal(rule.code, null);
});

test("upsertCatalogQuantityRule requires at least one of moq/step/max", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () => upsertCatalogQuantityRule({ catalogId: "c1", productId: "p1" }, client),
    /at least one/i,
  );
  const rule = await upsertCatalogQuantityRule(
    { catalogId: "c1", productId: "p1", moq: 3, step: 6, max: null },
    client,
  );
  assert.equal(rule.moq, 3);
  assert.equal(rule.step, 6);
  assert.equal(rule.max, null);
});

test("addCatalogMembership requires a product id", async () => {
  const client = makeFakeClient();
  await assert.rejects(() => addCatalogMembership({ catalogId: "c1", productId: "" }, client), /product id/i);
  const m = await addCatalogMembership({ catalogId: "c1", productId: "gid://shopify/Product/9" }, client);
  assert.equal(m.productId, "gid://shopify/Product/9");
});

test("upsertCatalogVariantVisibilityRule requires product + variant id and defaults to HIDDEN", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () => upsertCatalogVariantVisibilityRule({ catalogId: "c1", productId: "p1", variantId: "" }, client),
    /product id and a variant id/i,
  );
  const rule = await upsertCatalogVariantVisibilityRule(
    { catalogId: "c1", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/11" },
    client,
  );
  assert.equal(rule.visibilityMode, "HIDDEN");
  assert.equal(client._state.variantVisibility.length, 1);
});

test("handleCatalogsSettingsAction dispatches per-facet rule intents via injected deps", async () => {
  const calls: string[] = [];
  const deps = {
    upsertCatalogPriceRule: (async () => { calls.push("price"); return {} as any; }) as any,
    deleteCatalogPriceRule: (async (id: string) => { calls.push(`price-del:${id}`); }) as any,
    upsertCatalogFloorRule: (async () => { calls.push("floor"); return {} as any; }) as any,
    upsertCatalogDiscountRule: (async () => { calls.push("discount"); return {} as any; }) as any,
    upsertCatalogQuantityRule: (async () => { calls.push("quantity"); return {} as any; }) as any,
    addCatalogMembership: (async () => { calls.push("member"); return {} as any; }) as any,
    removeCatalogMembership: (async (id: string) => { calls.push(`member-del:${id}`); }) as any,
  };
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-price-rule", catalogId: "c1", scope: "CATALOG", mode: "PERCENT", value: "90" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "delete-catalog-price-rule", ruleId: "r1" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-floor-rule", catalogId: "c1", minPercentOfBasePrice: "70" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-discount-rule", catalogId: "c1", scope: "GLOBAL", percentOff: "10", priority: "100", stackMode: "STACKABLE" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-quantity-rule", catalogId: "c1", productId: "p1", moq: "3" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "add-catalog-membership", catalogId: "c1", productId: "p1" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "remove-catalog-membership", ruleId: "m1" }) }, deps);
  assert.deepEqual(calls, ["price", "price-del:r1", "floor", "discount", "quantity", "member", "member-del:m1"]);
});

test("resolveStorefrontCatalogVariantVisibility picks the highest-priority matching catalog's hidden variants", async () => {
  const client = makeFakeClient();
  // Seed two ACTIVE custom catalogs with audience + variant visibility rules.
  client._state.catalogs.set("silver", { id: "silver", name: "Silver", priority: 50, status: "ACTIVE", isSystem: false });
  client._state.catalogs.set("gold", { id: "gold", name: "Gold", priority: 90, status: "ACTIVE", isSystem: false });
  client._state.tags.push({ id: "t1", catalogId: "silver", tag: "loyal" });
  client._state.tags.push({ id: "t2", catalogId: "gold", tag: "loyal" });
  client._state.variantVisibility.push({ id: "v1", catalogId: "gold", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/11", visibilityMode: "HIDDEN" });
  client._state.variantVisibility.push({ id: "v2", catalogId: "silver", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/99", visibilityMode: "HIDDEN" });

  // findMany must honor where(status/isSystem) + include + orderBy(priority desc).
  const original = client.priceCatalog.findMany;
  client.priceCatalog.findMany = async (args: any) => {
    const all = [...client._state.catalogs.values()]
      .filter((c) => c.status === args?.where?.status && c.isSystem === args?.where?.isSystem)
      .map((c) => ({
        ...c,
        audienceTags: client._state.tags.filter((t) => t.catalogId === c.id),
        variantVisibilityRules: client._state.variantVisibility.filter((v) => v.catalogId === c.id),
      }))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return all;
  };

  const result = await resolveStorefrontCatalogVariantVisibility(["loyal"], client);
  client.priceCatalog.findMany = original;

  // Gold (priority 90) wins over Silver (50).
  assert.deepEqual(result, { "gid://shopify/Product/1": ["gid://shopify/ProductVariant/11"] });

  const none = await resolveStorefrontCatalogVariantVisibility([], client);
  assert.deepEqual(none, {});
});

test("upsertCatalogVisibilityRule requires a target id and defaults to HIDDEN", async () => {
  const client = makeFakeClient();
  await assert.rejects(
    () => upsertCatalogVisibilityRule({ catalogId: "c1", scope: "PRODUCT", targetId: "" }, client),
    /target id/i,
  );
  const rule = await upsertCatalogVisibilityRule(
    { catalogId: "c1", scope: "COLLECTION", targetId: "gid://shopify/Collection/1", handle: "x" },
    client,
  );
  assert.equal(rule.scope, "COLLECTION");
  assert.equal(rule.visibilityMode, "HIDDEN");
});

test("resolveStorefrontCatalogProductVisibility + loadCatalogCollectionVisibility read the matching catalog", async () => {
  const client = makeFakeClient();
  client._state.catalogs.set("gold", { id: "gold", name: "Gold", priority: 90, status: "ACTIVE", isSystem: false });
  client._state.tags.push({ id: "t", catalogId: "gold", tag: "gold" });
  client._state.visibility.push({ id: "p1", catalogId: "gold", scope: "PRODUCT", targetId: "gid://shopify/Product/9", handle: null, visibilityMode: "HIDDEN" });
  client._state.visibility.push({ id: "c1", catalogId: "gold", scope: "COLLECTION", targetId: "gid://shopify/Collection/77", handle: "wholesale", visibilityMode: "HIDDEN" });

  client.priceCatalog.findMany = async (args: any) =>
    [...client._state.catalogs.values()]
      .filter((c) => c.status === args?.where?.status && c.isSystem === args?.where?.isSystem)
      .map((c) => ({
        ...c,
        audienceTags: client._state.tags.filter((t) => t.catalogId === c.id),
        visibilityRules: client._state.visibility.filter((v) => v.catalogId === c.id),
      }))
      .sort((a, b) => b.priority - a.priority);

  assert.deepEqual(await resolveStorefrontCatalogProductVisibility(["gold"], client), [
    "gid://shopify/Product/9",
  ]);
  assert.deepEqual(await resolveStorefrontCatalogProductVisibility([], client), []);
  assert.deepEqual(await loadCatalogCollectionVisibility(client), [
    { catalogId: "gold", hiddenCollectionHandles: ["wholesale"] },
  ]);
});

test("cross-cutting CRUD: coupon normalizes, cap replaces, blacklist normalizes, customer-qty validates", async () => {
  const client = makeFakeClient();
  const coupon = await upsertCatalogCouponRule({ catalogId: "c1", code: " vip20 " }, client);
  assert.equal(coupon.code, "VIP20");

  await setCatalogDiscountCap({ catalogId: "c1", maxCombinedPercentOff: 40 }, client);
  await setCatalogDiscountCap({ catalogId: "c1", maxCombinedPercentOff: 30 }, client);
  const caps = client._state.caps.filter((c) => c.catalogId === "c1");
  assert.equal(caps.length, 1, "cap is replaced, not duplicated");
  assert.equal(caps[0].maxCombinedPercentOff, 30);

  const bl = await upsertCatalogBlacklistRule(
    { catalogId: "c1", leftType: "COUPON_CODE", leftValue: "a", rightType: "COUPON_CODE", rightValue: "b" },
    client,
  );
  assert.equal(bl.leftValue, "A");
  assert.equal(bl.rightValue, "B");

  await assert.rejects(
    () => upsertCatalogCustomerQuantityRule({ catalogId: "c1", customerId: "", productId: "p", maxOrderQuantity: 3 }, client),
    /customer id/i,
  );
  const cq = await upsertCatalogCustomerQuantityRule(
    { catalogId: "c1", customerId: "cust", productId: "p", maxOrderQuantity: 3 },
    client,
  );
  assert.equal(cq.maxOrderQuantity, 3);
});

test("handleCatalogsSettingsAction dispatches cross-cutting intents", async () => {
  const calls: string[] = [];
  const deps = {
    upsertCatalogCouponRule: (async () => { calls.push("coupon"); return {} as any; }) as any,
    setCatalogDiscountCap: (async () => { calls.push("cap"); return {} as any; }) as any,
    clearCatalogDiscountCap: (async () => { calls.push("cap-clear"); }) as any,
    upsertCatalogBlacklistRule: (async () => { calls.push("bl"); return {} as any; }) as any,
    upsertCatalogCustomerQuantityRule: (async () => { calls.push("cq"); return {} as any; }) as any,
  };
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-coupon", catalogId: "c1", code: "X" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-cap", catalogId: "c1", maxCombinedPercentOff: "40" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "delete-catalog-cap", catalogId: "c1" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-blacklist", catalogId: "c1", leftType: "COUPON_CODE", leftValue: "a", rightType: "COUPON_CODE", rightValue: "b" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-customer-quantity", catalogId: "c1", customerId: "c", productId: "p", maxOrderQuantity: "3" }) }, deps);
  assert.deepEqual(calls, ["coupon", "cap", "cap-clear", "bl", "cq"]);
});

test("handleCatalogsSettingsAction dispatches variant-visibility intents", async () => {
  const calls: string[] = [];
  const deps = {
    upsertCatalogVariantVisibilityRule: (async () => { calls.push("vv-save"); return {} as any; }) as any,
    deleteCatalogVariantVisibilityRule: (async (id: string) => { calls.push(`vv-del:${id}`); }) as any,
  };
  await handleCatalogsSettingsAction({ formData: formData({ intent: "save-catalog-variant-visibility", catalogId: "c1", productId: "p1", variantId: "v1", visibilityMode: "HIDDEN" }) }, deps);
  await handleCatalogsSettingsAction({ formData: formData({ intent: "delete-catalog-variant-visibility", ruleId: "vv1" }) }, deps);
  assert.deepEqual(calls, ["vv-save", "vv-del:vv1"]);
});

test("listPriceCatalogs returns catalogs with audience tags + market filters", async () => {
  const client = makeFakeClient();
  await createPriceCatalog(
    { name: "A", priority: 10, status: "ACTIVE", matchCompany: false, membershipMode: "OPT_IN", audienceTags: ["a"], marketFilters: [] },
    client,
  );
  const list = await listPriceCatalogs(client);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].audienceTags.map((t: any) => t.tag), ["a"]);
});
