import { describe, expect, it } from 'vitest';
import { draftRegistry, proposeUrl, registryFileName } from './communityIndex';
import { ModInfo } from '../types';

const mod = {
  mod_id: '2858201402/dailystatisticsandgains',
  name: 'Daily Statistics and Gains',
  author: 'Someone',
  workshop_id: '2858201402',
  dependencies: ['ModOptions'],
  incompatible: ['OtherStats'],
  enabled: true,
  load_order_index: 3,
} as unknown as ModInfo;

describe('draftRegistry', () => {
  it('fills the registry from mod.info and the build it runs on here', () => {
    const r = draftRegistry(mod, undefined, '42.21');
    expect(r.id).toBe(mod.mod_id);
    expect(r.workshop_id).toBe('2858201402');
    expect(r.builds).toEqual(['42']);
    expect(r.requires).toEqual(['ModOptions']);
    expect(r.incompatible[0]).toMatchObject({ id: 'OtherStats', status: 'verified' });
    expect(r.issues).toEqual([]);
  });

  it('claims no build for a mod this build cannot load', () => {
    expect(draftRegistry({ ...mod, loadable_on_installed_build: false }, undefined, '42.21').builds).toEqual([]);
  });
});

describe('proposeUrl', () => {
  it('opens the new-file page with the file name and the JSON filled in', () => {
    const url = proposeUrl(draftRegistry(mod, undefined, '42.21'));
    expect(url).toContain('/new/main/community/index?filename=2858201402__dailystatisticsandgains.json&value=');
    expect(decodeURIComponent(url.split('&value=')[1])).toContain('"id": "2858201402/dailystatisticsandgains"');
    expect(registryFileName('Plain')).toBe('Plain.json');
  });
});
