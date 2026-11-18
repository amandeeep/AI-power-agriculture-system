// Unit tests for the basic-mode keyword router and templates (no server needed).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-16';
process.env.ML_INTERNAL_KEY ||= 'k';
const { detectIntent, extractCity, extractCrop, extractSoil } = await import('../src/services/fallback/intents.js');
const { render, SUPPORTED } = await import('../src/services/fallback/templates.js');

describe('detectIntent', () => {
  const cases = [
    ['Which crop should I grow this season?', 'crop'],
    ['कौन सी फसल लगाऊं?', 'crop'],
    ['ఈ సీజన్‌లో ఏ పంట వేయాలి?', 'crop'],
    ['இந்த பருவத்தில் எந்த பயிர்?', 'crop'],
    ['ಈ ಹಂಗಾಮಿನಲ್ಲಿ ಯಾವ ಬೆಳೆ?', 'crop'],
    ['How much urea for my rice crop?', 'fertilizer'], // fertilizer beats crop
    ['धान के लिए कितनी खाद डालूं?', 'fertilizer'],
    ['వరికి ఎంత ఎరువు?', 'fertilizer'],
    ['நெல்லுக்கு எவ்வளவு உரம்?', 'fertilizer'],
    ['ಭತ್ತಕ್ಕೆ ಎಷ್ಟು ಗೊಬ್ಬರ?', 'fertilizer'],
    ['My tomato leaves have brown spots', 'disease'],
    ['टमाटर की पत्ती में रोग है', 'disease'],
    ['టమాటా ఆకులకు తెగులు వచ్చింది', 'disease'],
    ['தக்காளி இலையில் நோய்', 'disease'],
    ['ಟೊಮೆಟೊ ಎಲೆಗೆ ರೋಗ', 'disease'],
    ['Will it rain tomorrow?', 'weather'],
    ['कल मौसम कैसा रहेगा?', 'weather'],
    ['రేపు వర్షం పడుతుందా?', 'weather'],
    ['நாளை மழை வருமா?', 'weather'],
    ['ನಾಳೆ ಮಳೆ ಬರುತ್ತದೆಯೇ?', 'weather'],
    ['N 90 P 42 K 43 pH 6.5', 'crop'], // numbers only
    ['मेरी मिट्टी N 90, P 42, K 43, pH 6.5. इस मौसम में कौन सी फसल लगाऊं?', 'crop'], // मौसम = season here
    ['इस मौसम में कौन सी फसल लगाऊं?', 'crop'],
    ['कल मौसम में बारिश होगी?', 'weather'],
    ['tell me a joke', 'unknown'],
  ];
  for (const [msg, expected] of cases) {
    test(`${expected}: ${msg}`, () => assert.equal(detectIntent(msg), expected));
  }
  test('an attached image always means disease', () => assert.equal(detectIntent('hello', true), 'disease'));
});

describe('extractors', () => {
  test('soil values in different notations', () => {
    assert.deepEqual(extractSoil('N 90, P 42, K 43, pH 6.5'), { N: 90, P: 42, K: 43, ph: 6.5 });
    assert.deepEqual(extractSoil('nitrogen: 40 phosphorus=25 potassium is 70'), { N: 40, P: 25, K: 70 });
    assert.deepEqual(extractSoil('नाइट्रोजन 50 फास्फोरस 30 पोटैशियम 20 पीएच 7'), { N: 50, P: 30, K: 20, ph: 7 });
    assert.deepEqual(extractSoil('which crop?'), {});
  });

  test('crop names across languages', () => {
    assert.equal(extractCrop('urea for my paddy'), 'rice');
    assert.equal(extractCrop('धान के लिए खाद'), 'rice');
    assert.equal(extractCrop('వరికి ఎరువు'), 'rice');
    assert.equal(extractCrop('fertilizer for chana'), 'chickpea');
    assert.equal(extractCrop('ಹತ್ತಿ ಬೆಳೆಗೆ ಗೊಬ್ಬರ'), 'cotton');
  });

  test('city names', () => {
    assert.equal(extractCity('weather in New Delhi tomorrow'), 'New Delhi');
    assert.equal(extractCity('पुणे में मौसम'), 'पुणे');
    assert.equal(extractCity('weather?'), null);
  });
});

describe('templates', () => {
  test('every language has every template key that English has', () => {
    const keysOf = (lang) => {
      const out = [];
      const walk = (prefix, obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'object') walk(`${prefix}${k}.`, v);
          else out.push(`${prefix}${k}`);
        }
      };
      walk('', JSON.parse(JSON.stringify(Object.fromEntries(
        ['basicNotice', 'askSoil', 'cropHeader', 'cropLine', 'askFert', 'fertHeader', 'fertLine', 'fertNone', 'excess',
          'fertDisclaimer', 'askImage', 'diseaseFound', 'organic', 'chemical', 'healthy', 'uncertain', 'chemSafety',
          'weatherNow', 'weatherWeek', 'askLocation', 'help', 'serviceDown'].map((k) => [k, render(lang, k)])))));
      return out;
    };
    for (const lang of SUPPORTED) {
      for (const key of keysOf('en')) {
        const text = render(lang, key);
        assert.ok(lang === 'en' || text !== render('en', key), `${lang}.${key} is not translated`);
      }
    }
  });

  test('placeholders are filled', () => {
    assert.equal(render('hi', 'fertLine', { name: 'DAP', grade: '18-46-0', kg: 20 }), '• DAP (18-46-0): लगभग 20 किलो');
    assert.match(render('kn', 'alerts.heavy_rain', { date: '2026-07-11' }), /2026-07-11/);
  });
});
