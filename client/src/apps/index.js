import { morningConfig } from './morning/config';
import MorningSettings from './morning/Settings';

export const apps = [
    {
        ...morningConfig,
        settingsComponent: MorningSettings
    }
];

export const getApp = (id) => apps.find(app => app.id === id);

