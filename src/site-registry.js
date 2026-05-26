const fs = require('fs');
const path = require('path');

const RESERVED_SLUGS = new Set([
  'admin',
  'admin2',
  'admin-login',
  'admin.html',
  'api',
  'assets',
  'backups',
  'css',
  'favicon.ico',
  'game.html',
  'images',
  'js',
  'super-admin'
]);

class SiteRegistry {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
    this.sitesDir = path.resolve(options.sitesDir || path.join(this.rootDir, 'sites'));
    this.registryPath = path.resolve(options.registryPath || path.join(this.sitesDir, 'sites.json'));
    fs.mkdirSync(this.sitesDir, { recursive: true });
    this.sites = this.loadSites();
  }

  loadSites() {
    if (!fs.existsSync(this.registryPath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Array.isArray(parsed.sites) ? parsed.sites : [];
    } catch (error) {
      console.error('[SiteRegistry] Không đọc được sites registry:', error.message);
      return [];
    }
  }

  saveSites() {
    const payload = {
      sites: this.sites
    };
    fs.writeFileSync(this.registryPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  normalizeSlug(slug) {
    return String(slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  validateSlug(slug) {
    const normalized = this.normalizeSlug(slug);
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(normalized)) {
      throw new Error('Slug phải dài 3-40 ký tự, chỉ gồm chữ thường, số và dấu gạch ngang');
    }
    if (RESERVED_SLUGS.has(normalized)) {
      throw new Error('Slug này đang được hệ thống sử dụng');
    }
    if (this.getSite(normalized)) {
      throw new Error('Site này đã tồn tại');
    }
    return normalized;
  }

  getSite(slug) {
    const normalized = this.normalizeSlug(slug);
    return this.sites.find((site) => site.slug === normalized) || null;
  }

  listSites() {
    return this.sites
      .slice()
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .map((site) => ({
        ...site,
        url_path: `/${site.slug}`,
        admin_path: `/${site.slug}/admin`
      }));
  }

  createSite({ slug, name }) {
    const normalizedSlug = this.validateSlug(slug);
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      throw new Error('Tên site không được để trống');
    }

    const site = {
      id: Date.now(),
      slug: normalizedSlug,
      name: normalizedName,
      active: true,
      db_path: path.join(this.sitesDir, `${normalizedSlug}.db`),
      created_at: new Date().toISOString()
    };

    this.sites.push(site);
    this.saveSites();
    return site;
  }

  updateSiteStatus(slug, active) {
    const normalized = this.normalizeSlug(slug);
    const site = this.getSite(normalized);
    if (!site) {
      throw new Error('Site không tồn tại');
    }

    site.active = Boolean(active);
    site.updated_at = new Date().toISOString();
    this.saveSites();
    return site;
  }
}

module.exports = SiteRegistry;
