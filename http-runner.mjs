import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

let axiosLoaderPromise = null;
let filePolyfillPromise = null;

async function ensureFilePolyfill() {
  if (typeof globalThis.File === 'function') {
    return;
  }
  if (!filePolyfillPromise) {
    filePolyfillPromise = (async () => {
      try {
        if (typeof globalThis.Blob !== 'function') {
          const blobModule = await import('fetch-blob');
          const blobCtor =
            typeof blobModule.default === 'function'
              ? blobModule.default
              : typeof blobModule.Blob === 'function'
                ? blobModule.Blob
                : null;
          if (blobCtor) {
            globalThis.Blob = blobCtor;
          }
        }

        if (typeof globalThis.Blob !== 'function') {
          throw new Error(
            "Impossible d'initialiser l'API Blob nécessaire au polyfill File."
          );
        }

        if (typeof globalThis.File !== 'function') {
          const BlobCtor = globalThis.Blob;

          class FilePolyfill extends BlobCtor {
            constructor(fileBits, fileName, options = {}) {
              if (arguments.length < 2) {
                throw new TypeError(
                  "Failed to construct 'File': 2 arguments required, but only " +
                    arguments.length +
                    ' present.'
                );
              }

              const opts = options ?? {};
              const blobOptions = {};
              if (opts.type !== undefined) {
                blobOptions.type = opts.type;
              }
              if (opts.endings !== undefined) {
                blobOptions.endings = opts.endings;
              }

              super(fileBits, blobOptions);

              const coercedLastModified =
                opts.lastModified === undefined
                  ? Date.now()
                  : Number(opts.lastModified);
              const safeLastModified = Number.isFinite(coercedLastModified)
                ? coercedLastModified
                : Date.now();
              const webkitRelativePath =
                typeof opts.webkitRelativePath === 'string'
                  ? opts.webkitRelativePath
                  : '';

              Object.defineProperties(this, {
                name: {
                  value: String(fileName),
                  writable: false,
                  enumerable: false,
                  configurable: false
                },
                lastModified: {
                  value: safeLastModified,
                  writable: false,
                  enumerable: false,
                  configurable: false
                },
                webkitRelativePath: {
                  value: webkitRelativePath,
                  writable: false,
                  enumerable: false,
                  configurable: false
                }
              });
            }
          }

          Object.defineProperty(FilePolyfill.prototype, Symbol.toStringTag, {
            value: 'File',
            writable: false,
            enumerable: false,
            configurable: true
          });

          globalThis.File = FilePolyfill;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Impossible d'initialiser le polyfill File: ${reason}`
        );
      }

      if (typeof globalThis.File !== 'function') {
        throw new Error(
          "Le polyfill File n'a pas pu être initialisé. axios requiert l'API File en environnement Node.js."
        );
      }
    })();
  }
  await filePolyfillPromise;
}

async function loadAxiosDependencies() {
  if (!axiosLoaderPromise) {
    axiosLoaderPromise = (async () => {
      await ensureFilePolyfill();
      const [{ default: axios }, cookieJarModule] = await Promise.all([
        import('axios'),
        import('axios-cookiejar-support')
      ]);
      const wrapper =
        cookieJarModule.wrapper ||
        (typeof cookieJarModule.default === 'function'
          ? cookieJarModule.default
          : cookieJarModule.default?.wrapper);
      if (typeof wrapper !== 'function') {
        throw new Error('axios-cookiejar-support wrapper helper non disponible.');
      }
      return { axios, wrapper };
    })();
  }
  return axiosLoaderPromise;
}

const DEFAULT_HTTP_SETTINGS = {
  mode: 'live',
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  requestHeaders: {
    html: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  },
  endpoints: {
    login: {
      method: 'POST',
      fetchInitialPage: true,
      formSelector: 'form',
      usernameField: 'email',
      passwordField: 'pass',
      encoding: 'form'
    },
    reservationPage: {
      path: 'reservation.html',
      method: 'GET',
      dateFormat: 'DD/MM/YYYY',
      dateQueryParam: 'date'
    },
    finalize: {
      method: 'POST',
      encoding: 'form',
      fields: {
        court: 'idcourt',
        slot: 'idhoraire',
        hour: 'heure',
        date: 'date',
        testMode: 'test',
        partner: 'idplayer_{position}'
      }
    }
  },
  selectors: {
    reservationForm: [
      'form#formReservation',
      'form#reservation-form',
      'form[action*="reservation"]',
      'form[name="formReservation"]'
    ],
    court: '.bloccourt',
    courtIdAttr: 'data-idcourt',
    courtName: '.blocCourt_title, .blocCourt_top h3, .court-name',
    slotButton: '.blocCourt_container_btn-creneau button.btn_creneau',
    slotIdAttr: 'idhoraire',
    skipDisabledClass: ['disabled', 'btn_creneau__indispo']
  },
  mockData: null
};

function deepMerge(base, override) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  if (!override || typeof override !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    if (
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normaliseHour(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const hMatch = lower.match(/^(\d{1,2})\s*h\s*(\d{2})$/);
  if (hMatch) {
    return `${hMatch[1].padStart(2, '0')}:${hMatch[2]}`;
  }
  const colonMatch = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
  }
  const compactMatch = lower.match(/^(\d{3,4})$/);
  if (compactMatch) {
    const digits = compactMatch[1].padStart(4, '0');
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  return raw;
}

function hourToMinutes(value) {
  const normalised = normaliseHour(value);
  if (!normalised) return Number.NaN;
  const [hours, minutes] = normalised.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

function computeHourScore(hour, preferences) {
  const normalised = normaliseHour(hour);
  if (!normalised) {
    return { score: Number.POSITIVE_INFINITY };
  }
  const exactIndex = preferences.findIndex(
    (pref) => normaliseHour(pref) === normalised
  );
  if (exactIndex !== -1) {
    return {
      score: exactIndex,
      fallback: false,
      matchedPreference: preferences[exactIndex],
      difference: 0
    };
  }
  const hourMinutes = hourToMinutes(normalised);
  if (!Number.isFinite(hourMinutes)) {
    return { score: Number.POSITIVE_INFINITY };
  }
  let best = null;
  preferences.forEach((pref, index) => {
    const prefMinutes = hourToMinutes(pref);
    if (!Number.isFinite(prefMinutes)) return;
    const diff = Math.abs(prefMinutes - hourMinutes);
    if (diff <= 30) {
      const score = preferences.length + diff + index / 100;
      if (!best || score < best.score) {
        best = {
          score,
          fallback: true,
          matchedPreference: pref,
          difference: diff
        };
      }
    }
  });
  return best || { score: Number.POSITIVE_INFINITY };
}

function computeCourtScore(courtId, preferences, usePreferences) {
  if (!usePreferences || !Array.isArray(preferences) || preferences.length === 0) {
    return 0;
  }
  const id = String(courtId ?? '');
  const index = preferences.findIndex((pref) => String(pref) === id);
  if (index !== -1) {
    return index;
  }
  return preferences.length + 1;
}

function selectBestSlot(slots, config, log) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return { slot: null };
  }
  const hourPreferences = Array.isArray(config.hourPreferences)
    ? config.hourPreferences
    : [];
  const courtPreferences = Array.isArray(config?.courts?.preferences)
    ? config.courts.preferences.map(String)
    : [];
  const scored = slots
    .map((slot) => {
      const hourInfo = computeHourScore(slot.hour, hourPreferences);
      const courtScore = computeCourtScore(
        slot.courtId,
        courtPreferences,
        Boolean(config.useCourtPreferences)
      );
      return { slot, hourInfo, courtScore };
    })
    .filter((entry) => Number.isFinite(entry.hourInfo.score));

  if (scored.length === 0) {
    log(
      'warning',
      'Aucun créneau ne correspond exactement ni approximativement aux horaires préférés.'
    );
    return { slot: null };
  }

  scored.sort((a, b) => {
    if (a.courtScore !== b.courtScore) {
      return a.courtScore - b.courtScore;
    }
    if (a.hourInfo.score !== b.hourInfo.score) {
      return a.hourInfo.score - b.hourInfo.score;
    }
    return 0;
  });

  const best = scored[0];
  const result = {
    slot: {
      ...best.slot,
      matchedPreference: best.hourInfo.matchedPreference,
      fallback: Boolean(best.hourInfo.fallback),
      difference: best.hourInfo.difference ?? 0
    },
    fallback: Boolean(best.hourInfo.fallback),
    matchedPreference: best.hourInfo.matchedPreference,
    difference: best.hourInfo.difference ?? 0
  };

  if (result.slot.fallback) {
    log(
      'warning',
      `Aucun horaire strictement préféré disponible, sélection du créneau ${result.slot.hour} (écart ${result.difference} minutes par rapport à ${result.matchedPreference || 'N/A'}).`
    );
  }

  return result;
}

function extractAttributes(element) {
  const attributes = {};
  if (!element || !element.attribs) {
    return attributes;
  }
  for (const [key, value] of Object.entries(element.attribs)) {
    attributes[key] = value;
    if (key.startsWith('data-')) {
      const normalized = key.slice(5);
      attributes[normalized] = value;
    }
  }
  return attributes;
}

function extractForm($, selectors) {
  let form = null;
  if (Array.isArray(selectors)) {
    for (const selector of selectors) {
      const candidate = $(selector);
      if (candidate && candidate.length) {
        form = candidate.first();
        break;
      }
    }
  } else if (selectors) {
    const candidate = $(selectors);
    if (candidate && candidate.length) {
      form = candidate.first();
    }
  }
  if (!form || !form.length) {
    const first = $('form').first();
    if (first && first.length) {
      form = first;
    }
  }
  if (!form || !form.length) {
    return { action: null, method: 'POST', fields: {} };
  }
  const fields = {};
  form.find('input, select, textarea').each((_, elem) => {
    const $elem = $(elem);
    const name = $elem.attr('name');
    if (!name) return;
    const tag = (elem.tagName || elem.name || '').toLowerCase();
    const type = ($elem.attr('type') || '').toLowerCase();
    if (tag === 'select') {
      const selected = $elem.find('option[selected]');
      if (selected.length) {
        fields[name] = selected.attr('value') ?? selected.text().trim();
      }
      return;
    }
    if (type === 'checkbox' || type === 'radio') {
      if ($elem.is(':checked')) {
        fields[name] = $elem.attr('value') ?? 'on';
      }
      return;
    }
    fields[name] = $elem.attr('value') ?? '';
  });
  return {
    action: form.attr('action') || null,
    method: (form.attr('method') || 'POST').toUpperCase(),
    fields
  };
}

function parseSlotsFromHtml(html, config, httpSettings) {
  if (!html) {
    return { form: { action: null, method: 'POST', fields: {} }, slots: [] };
  }
  const $ = cheerio.load(html);
  const form = extractForm($, httpSettings.selectors.reservationForm);
  const slots = [];
  $(httpSettings.selectors.court).each((_, courtElement) => {
    const attributes = extractAttributes(courtElement);
    const courtId = attributes[httpSettings.selectors.courtIdAttr] ||
      attributes[(httpSettings.selectors.courtIdAttr || '').replace(/^data-/, '')] ||
      attributes.idcourt ||
      attributes.id ||
      null;
    const courtName =
      config?.courts?.[courtId] ||
      ($(courtElement)
        .find(httpSettings.selectors.courtName)
        .first()
        .text()
        .trim() || courtId || 'Inconnu');
    $(courtElement)
      .find(httpSettings.selectors.slotButton)
      .each((_, button) => {
        const $btn = $(button);
        if ($btn.attr('disabled')) return;
        if (
          Array.isArray(httpSettings.selectors.skipDisabledClass) &&
          httpSettings.selectors.skipDisabledClass.some((cls) => $btn.hasClass(cls))
        ) {
          return;
        }
        const text = $btn.text().replace(/\s+/g, ' ').trim();
        if (!text) return;
        const btnAttributes = extractAttributes(button);
        const candidateIds = [
          httpSettings.selectors.slotIdAttr,
          'idhoraire',
          'id-horaire',
          'id',
          'value',
          'creneau',
          'slot',
          'idcreneau'
        ]
          .filter(Boolean)
          .map((key) => btnAttributes[key] || btnAttributes[`data-${key}`] || null);
        const slotId = candidateIds.find((val) => val != null && val !== '') || null;
        slots.push({
          courtId: courtId ? String(courtId) : undefined,
          courtName,
          hour: text,
          slotId: slotId ? String(slotId) : undefined,
          rawAttributes: btnAttributes,
          source: 'html'
        });
      });
  });
  return { form, slots };
}

function parseSlotsFromJson(data, config) {
  if (!data) return [];
  const entries = Array.isArray(data)
    ? data
    : Array.isArray(data?.slots)
    ? data.slots
    : Array.isArray(data?.disponibilites)
    ? data.disponibilites
    : Array.isArray(data?.result)
    ? data.result
    : [];
  return entries
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const courtId =
        item.courtId ??
        item.idcourt ??
        item.idCourt ??
        item.idTerrain ??
        item.terrain ??
        item.id_terrain;
      const hour = item.hour ?? item.heure ?? item.creneau ?? item.time;
      const slotId =
        item.slotId ??
        item.idHoraire ??
        item.idhoraire ??
        item.idcreneau ??
        item.id_creneau;
      const available = item.available ?? item.disponible ?? item.isAvailable;
      if (available === false || available === 0 || available === '0') {
        return null;
      }
      if (!courtId || !hour) {
        return null;
      }
      return {
        courtId: String(courtId),
        courtName:
          config?.courts?.[courtId] || item.courtName || item.nomCourt || `Terrain ${courtId}`,
        hour: String(hour),
        slotId: slotId ? String(slotId) : undefined,
        raw: item,
        source: 'json'
      };
    })
    .filter(Boolean);
}

function formatDate(date, template) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return template
    .replace(/DD/g, dd)
    .replace(/MM/g, mm)
    .replace(/YYYY/g, yyyy);
}

function resolveTargetDate(config, httpSettings) {
  const reservationPage = httpSettings.endpoints.reservationPage || {};
  let targetDate;
  if (config.reservationDate) {
    const [year, month, day] = config.reservationDate.split('-').map(Number);
    targetDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  } else {
    const advance = Number.isFinite(Number(config.bookingAdvance))
      ? Number(config.bookingAdvance)
      : 7;
    targetDate = new Date();
    targetDate.setHours(12, 0, 0, 0);
    targetDate.setDate(targetDate.getDate() + advance);
  }
  return {
    date: targetDate,
    iso: formatDate(targetDate, 'YYYY-MM-DD'),
    display: formatDate(targetDate, 'DD/MM/YYYY'),
    formattedForRequest: formatDate(
      targetDate,
      reservationPage.dateFormat || 'DD/MM/YYYY'
    ),
    ajaxFormat: formatDate(
      targetDate,
      reservationPage.ajaxDateFormat || reservationPage.dateFormat || 'YYYY-MM-DD'
    )
  };
}

function buildHtmlHeaders(httpSettings) {
  return {
    ...httpSettings.requestHeaders?.html,
    'User-Agent': httpSettings.userAgent
  };
}

async function createHttpClient(httpSettings) {
  const { axios, wrapper } = await loadAxiosDependencies();
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      withCredentials: true,
      jar,
      maxRedirects: 10,
      headers: {
        'User-Agent': httpSettings.userAgent
      },
      validateStatus: (status) => status >= 200 && status < 400
    })
  );
  return { client, jar };
}

async function performLogin(client, config, runtime, httpSettings) {
  const { log } = runtime;
  const loginSettings = httpSettings.endpoints.login || {};
  const loginUrl = loginSettings.url || config.loginUrl;
  log('step', 'Authentification via HTTP...');
  let payload = {};
  if (loginSettings.fetchInitialPage !== false) {
    const response = await client.get(loginUrl, {
      headers: buildHtmlHeaders(httpSettings)
    });
    const { form } = parseSlotsFromHtml(response.data, config, httpSettings);
    payload = { ...(form?.fields || {}) };
  }
  const usernameField = loginSettings.usernameField || 'email';
  const passwordField = loginSettings.passwordField || 'pass';
  payload[usernameField] = config.username;
  payload[passwordField] = config.password;
  if (loginSettings.staticFields) {
    Object.assign(payload, loginSettings.staticFields);
  }
  const encoding = loginSettings.encoding || 'form';
  if (encoding === 'json') {
    await client.post(loginUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
  } else {
    const body = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        body.append(key, String(value));
      }
    });
    await client.post(loginUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }
  log('success', 'Connexion HTTP effectuée.');
}

async function fetchReservationContext(client, config, runtime, httpSettings, target) {
  const { log } = runtime;
  const reservationSettings = httpSettings.endpoints.reservationPage || {};
  const baseUrl = httpSettings.baseUrl || config.memberUrl;
  const pageUrl = reservationSettings.url
    ? reservationSettings.url
    : new URL(reservationSettings.path || 'reservation.html', baseUrl).toString();
  const url = new URL(pageUrl);
  if (reservationSettings.dateQueryParam) {
    url.searchParams.set(
      reservationSettings.dateQueryParam,
      target.formattedForRequest
    );
  }
  log('step', `Chargement des créneaux pour le ${target.display}...`);
  const response = await client.get(url.toString(), {
    headers: buildHtmlHeaders(httpSettings)
  });
  let { form, slots } = parseSlotsFromHtml(response.data, config, httpSettings);
  if ((!slots || slots.length === 0) && reservationSettings.ajaxEndpoint) {
    const ajaxUrl = new URL(reservationSettings.ajaxEndpoint, baseUrl);
    const ajaxMethod = (reservationSettings.ajaxMethod || 'GET').toUpperCase();
    const ajaxParams = {
      ...(reservationSettings.ajaxStaticParams || {}),
      [
        reservationSettings.ajaxDateParam ||
          reservationSettings.dateQueryParam ||
          'date'
      ]: target.ajaxFormat
    };
    let ajaxResponse;
    if (ajaxMethod === 'GET') {
      const ajaxRequestUrl = new URL(ajaxUrl.toString());
      Object.entries(ajaxParams).forEach(([key, value]) => {
        ajaxRequestUrl.searchParams.set(key, String(value));
      });
      ajaxResponse = await client.get(ajaxRequestUrl.toString(), {
        headers: reservationSettings.ajaxHeaders || {
          Accept: 'application/json, text/javascript, */*;q=0.1'
        }
      });
    } else {
      const body = new URLSearchParams();
      Object.entries(ajaxParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          body.append(key, String(value));
        }
      });
      ajaxResponse = await client.post(ajaxUrl.toString(), body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(reservationSettings.ajaxHeaders || {})
        }
      });
    }
    const ajaxType = reservationSettings.ajaxResponseType || 'json';
    if (ajaxType === 'json') {
      slots = parseSlotsFromJson(ajaxResponse.data, config);
    } else {
      const parsed = parseSlotsFromHtml(ajaxResponse.data, config, httpSettings);
      slots = parsed.slots;
    }
  }
  log('info', `${slots.length} créneau(x) disponible(s) récupéré(s).`);
  return { form, slots, target };
}

async function submitReservation(
  client,
  config,
  runtime,
  httpSettings,
  context,
  selection
) {
  const { log } = runtime;
  const finalizeSettings = httpSettings.endpoints.finalize || {};
  const baseUrl = httpSettings.baseUrl || config.memberUrl;
  let actionUrl = finalizeSettings.url;
  if (!actionUrl && context.form?.action) {
    actionUrl = new URL(context.form.action, baseUrl).toString();
  }
  if (!actionUrl && finalizeSettings.path) {
    actionUrl = new URL(finalizeSettings.path, baseUrl).toString();
  }
  if (!actionUrl) {
    actionUrl = new URL('reservation.html', baseUrl).toString();
  }
  const method = (finalizeSettings.method || context.form?.method || 'POST').toUpperCase();
  const payload = { ...(context.form?.fields || {}) };
  const fields = finalizeSettings.fields || {};
  if (fields.court) {
    payload[fields.court] = selection.slot.courtId;
  }
  if (fields.slot && selection.slot.slotId) {
    payload[fields.slot] = selection.slot.slotId;
  }
  if (fields.hour) {
    payload[fields.hour] = selection.slot.hour;
  }
  if (fields.date) {
    payload[fields.date] = context.target.formattedForRequest;
  }
  if (fields.testMode && config.testMode) {
    payload[fields.testMode] = '1';
  }
  if (Array.isArray(config.partners)) {
    config.partners.forEach((partner) => {
      if (!partner || !fields.partner) return;
      const template = fields.partner;
      const fieldName = template
        .replace('{position}', String(partner.position ?? 0))
        .replace('{index}', String(partner.position ?? 0))
        .replace('{number}', String((partner.position ?? 0) + 1));
      payload[fieldName] = partner.playerId;
    });
  }
  log('step', 'Envoi du formulaire de réservation...');
  if (config.testMode) {
    log('info', 'Mode test activé, aucun appel HTTP final n\'est réalisé.');
    return;
  }
  if (method === 'GET') {
    const url = new URL(actionUrl);
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    await client.get(url.toString(), { headers: finalizeSettings.headers || {} });
  } else if (finalizeSettings.encoding === 'json') {
    await client.post(actionUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(finalizeSettings.headers || {})
      }
    });
  } else {
    const body = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        body.append(key, String(value));
      }
    });
    await client.post(actionUrl, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(finalizeSettings.headers || {})
      }
    });
  }
  log('success', 'Réservation HTTP envoyée avec succès.');
}

async function runMockFlow(config, runtime, httpSettings, target) {
  const { log } = runtime;
  const mockSlots = httpSettings.mockData?.availableSlots || [];
  log('step', 'Mode HTTP mock activé, simulation sans appels réseau.');
  const selection = selectBestSlot(mockSlots, config, log);
  if (!selection.slot) {
    throw new Error(
      'Mode mock: aucun créneau compatible avec les préférences fournies.'
    );
  }
  log(
    'success',
    `Simulation: créneau ${selection.slot.hour} retenu sur ${selection.slot.courtName || selection.slot.courtId}.`
  );
  if (config.testMode) {
    log('info', 'Mode test et mock actifs: aucune réservation réelle effectuée.');
  }
  if (httpSettings.mockData?.onSuccessMessage) {
    log('info', httpSettings.mockData.onSuccessMessage);
  }
}

export async function runHttpRunner({ config, runtime }) {
  const httpSettings = deepMerge(DEFAULT_HTTP_SETTINGS, config.http || {});
  httpSettings.baseUrl = httpSettings.baseUrl || config.memberUrl;
  const { log } = runtime;
  const target = resolveTargetDate(config, httpSettings);
  log('info', `Date cible pour la réservation: ${target.display}`);
  if ((httpSettings.mode || 'live') === 'mock') {
    await runMockFlow(config, runtime, httpSettings, target);
    return;
  }
  const { client } = await createHttpClient(httpSettings);
  await performLogin(client, config, runtime, httpSettings);
  const context = await fetchReservationContext(
    client,
    config,
    runtime,
    httpSettings,
    target
  );
  const selection = selectBestSlot(context.slots, config, log);
  if (!selection.slot) {
    throw new Error(
      'Aucun créneau disponible ne correspond aux préférences fournies.'
    );
  }
  const courtLabel =
    selection.slot.courtName ||
    config?.courts?.[selection.slot.courtId] ||
    selection.slot.courtId;
  log(
    'success',
    `Créneau retenu: ${selection.slot.hour} sur ${courtLabel} (court ${selection.slot.courtId || 'n/a'}).`
  );
  await submitReservation(
    client,
    config,
    runtime,
    httpSettings,
    { ...context, target },
    selection
  );
  log('success', 'Moteur HTTP terminé.');
}
