import type { GlobalConfig } from 'payload';
import { Header } from './Header';
import { SiteSettings } from './SiteSettings';
import { Theme } from './Theme';

export const globals: GlobalConfig[] = [Theme, SiteSettings, Header];

export default globals;
