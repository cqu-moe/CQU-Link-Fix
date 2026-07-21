import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('production design system package', () => {
  it('keeps the approved Open Design rules in the repository', async () => {
    const design = await readFile(resolve(root, 'DESIGN.md'), 'utf8');

    expect(design).toContain('# CQU Link Fix 设计系统');
    expect(design).toContain('--accent');
    expect(design).toContain('折返路径标');
  });

  it('packages the local Geist fonts and single-source brand mark', async () => {
    await Promise.all([
      access(resolve(root, 'public/fonts/Geist-Variable.woff2')),
      access(resolve(root, 'public/fonts/GeistMono-Variable.woff2')),
      access(resolve(root, 'public/brand/cqu-link-fix-mark.svg')),
      access(resolve(root, 'public/icon/16.png')),
      access(resolve(root, 'public/icon/32.png')),
      access(resolve(root, 'public/icon/48.png')),
      access(resolve(root, 'public/icon/128.png')),
    ]);
  });

  it('bumps the redesign release and wires runtime icons into the manifest', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, 'package.json'), 'utf8'),
    ) as { version: string };
    const config = await readFile(resolve(root, 'wxt.config.ts'), 'utf8');

    expect(packageJson.version).toBe('0.3.0');
    expect(config).toContain("'16': 'icon/16.png'");
    expect(config).toContain("'128': 'icon/128.png'");
    expect(config).toContain('default_icon');
  });

  it('keeps operation feedback accessible without rendering a visible status row', async () => {
    const optionsApp = await readFile(
      resolve(root, 'entrypoints/options/App.tsx'),
      'utf8',
    );

    expect(optionsApp).toContain('id="status" className="visually-hidden"');
    expect(optionsApp).not.toContain('className="operation-status"');
  });

  it('keeps the all-CQU switch without the implementation-detail permission note', async () => {
    const optionsApp = await readFile(
      resolve(root, 'entrypoints/options/App.tsx'),
      'utf8',
    );

    expect(optionsApp).toContain('id="all-cqu-enabled"');
    expect(optionsApp).not.toContain('className="permission-note"');
    expect(optionsApp).not.toContain('optional_host_permissions');
  });

  it('renders built-ins as adjacent rows with no group-level styling', async () => {
    const optionsCss = await readFile(
      resolve(root, 'entrypoints/options/style.css'),
      'utf8',
    );

    expect(optionsCss).not.toContain('.rule-groups fieldset');
    expect(optionsCss).not.toContain('.rule-groups legend');
    expect(optionsCss).not.toContain('.group-description');
    expect(optionsCss).toMatch(
      /\.rule-groups > \.rule-row \+ \.rule-row\s*{[^}]*border-top:\s*1px solid var\(--border-soft\)/s,
    );
    const baseRuleRow = optionsCss.match(/^\.rule-row\s*{([^}]*)}/ms)?.[1] ?? '';
    expect(baseRuleRow).not.toContain('border-top');
  });
});
