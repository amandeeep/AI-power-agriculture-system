import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import { weatherKey } from '../lib/constants';

const ICONS = {
  clear: Sun, mainlyClear: CloudSun, partlyCloudy: CloudSun, overcast: Cloud, fog: CloudFog, drizzle: CloudDrizzle,
  rain: CloudRain, heavyRain: CloudRain, freezingRain: CloudRain, snow: CloudSnow, showers: CloudRain,
  thunderstorm: CloudLightning, unknown: Cloud,
};

export default function WeatherIcon({ code, className = 'size-6' }) {
  const Icon = ICONS[weatherKey(code)];
  return <Icon className={className} aria-hidden />;
}
