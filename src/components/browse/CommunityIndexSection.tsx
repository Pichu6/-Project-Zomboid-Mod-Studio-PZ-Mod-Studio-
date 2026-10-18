import React from 'react';
import { CommunityRegistry } from '../../types';
import { Chip } from './common';

const seenOn = (e: { build?: string | null; status?: string }) => `${e.status === 'verified' ? 'verified' : 'reported'}${e.build ? ` on ${e.build}` : ''}`;

/**
 * What the community index knows about a mod, on the Browse page before anything is installed:
 * the builds it runs on, what it clashes with, its known issues and whether the Studio can fix
 * each. Every line says the build it was seen on, so "reported on 42.19" reads as such on 42.21.
 */
export const CommunityIndexSection: React.FC<{ registries: CommunityRegistry[]; installedBuild: string | null; nameOf?: (id: string) => string }> = ({ registries, installedBuild, nameOf = (id) => id }) => {
  if (registries.length === 0) return null;
  const major = installedBuild?.match(/^\d{2}/)?.[0] ?? null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">Community index</h3>
      {registries.map((r) => {
        const notForBuild = major !== null && r.builds.length > 0 && !r.builds.includes(major);
        const fixable = r.issues.filter((i) => i.fix.kind !== 'none').length;
        return (
          <div key={r.id} className="flex flex-col gap-1.5 text-[11px]">
            {registries.length > 1 && <div className="font-mono text-slate-400">{r.id}</div>}
            <div className="flex flex-wrap gap-1">
              {r.builds.map((b) => (
                <Chip key={b} className={b === major ? 'border-emerald-600/60 text-emerald-300' : 'border-slate-700 text-slate-300'}>Build {b}</Chip>
              ))}
              {notForBuild && <Chip className="border-amber-500/60 text-amber-300">Not for Build {major}, per the index</Chip>}
              {r.incompatible.length > 0 && <Chip className="border-amber-500/60 text-amber-300">{r.incompatible.length} incompatible</Chip>}
              {r.issues.length > 0 && (
                <Chip className={fixable ? 'border-sky-600/60 text-sky-300' : 'border-slate-700 text-slate-300'}>
                  {r.issues.length} known issue{r.issues.length === 1 ? '' : 's'}{fixable ? `, ${fixable} the Studio fixes` : ''}
                </Chip>
              )}
            </div>
            {r.successor && notForBuild && (
              <p className="text-sky-300">There is a version for Build {major}: {nameOf(r.successor.id)}{r.successor.note ? ` (${r.successor.note})` : ''}</p>
            )}
            {r.incompatible.map((rel) => (
              <p key={rel.id} className="text-slate-300">
                Does not go with <b>{nameOf(rel.id)}</b>{rel.note ? `: ${rel.note}` : ''} <span className="text-slate-500">({seenOn(rel)})</span>
              </p>
            ))}
            {r.load_after.map((rel) => (
              <p key={rel.id} className="text-slate-300">
                Loads after <b>{nameOf(rel.id)}</b>{rel.note ? `: ${rel.note}` : ''} <span className="text-slate-500">({seenOn(rel)})</span>
              </p>
            ))}
            {r.issues.map((issue, i) => (
              <p key={i} className="text-slate-300">
                {issue.title}
                {issue.file ? <span className="font-mono text-slate-500"> {issue.file}{issue.line ? `:${issue.line}` : ''}</span> : null}
                {issue.note ? ` — ${issue.note}` : ''}{' '}
                <span className={issue.fix.kind === 'none' ? 'text-slate-500' : 'text-sky-300'}>
                  {issue.fix.kind === 'shim_patch' ? '(the Studio\'s shim patches it)' : issue.fix.kind === 'none' ? '(nothing to fix)' : '(the Studio fixes it: compatible copy, or Fix the path in the Monitor Center)'}
                </span>{' '}
                <span className="text-slate-500">({seenOn(issue)})</span>
              </p>
            ))}
          </div>
        );
      })}
    </section>
  );
};
