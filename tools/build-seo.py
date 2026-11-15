#!/usr/bin/env python3
"""Regenerate sitemap.xml, llms.txt and llms-full.txt from the pages on disk.

Run from the repo root after adding or editing a page:

    python3 tools/build-seo.py

- sitemap.xml   every public page, <lastmod> from git (or today for uncommitted
                files), plus <image:image> for blog hero photos.
- llms.txt      short map of the site for AI assistants (llmstxt.org format):
                the hand-written intro below + every blog guide, grouped.
- llms-full.txt the same intro + the full text of every guide and the FAQs of
                the main pages, as plain Markdown, so an assistant can read the
                whole site in one fetch.

Blog guides are discovered automatically from blog/*.html (title, description,
category, hero image are read from each file), so a new article only needs
its HTML file.
"""
import datetime
import glob
import html
import json
import os
import re
import subprocess
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://www.drivee.ca'
TODAY = datetime.date.today().isoformat()

# (path, file, changefreq, priority)
STATIC_PAGES = [
    ('/', 'index.html', 'weekly', '1.0'),
    ('/report.html', 'report.html', 'weekly', '0.95'),
    ('/app.html', 'app.html', 'weekly', '0.9'),
    ('/mechanic.html', 'mechanic.html', 'monthly', '0.8'),
    ('/parking-signs/', 'parking-signs/index.html', 'monthly', '0.8'),
    ('/blog/', 'blog/index.html', 'weekly', '0.8'),
    ('/contact.html', 'contact.html', 'yearly', '0.4'),
    ('/privacy.html', 'privacy.html', 'yearly', '0.2'),
]

INTRO = """# Drivee

> Drivee (drivee.ca) is an independent, Toronto-built web app for drivers in Canada and the United States. It does two things: (1) vehicle history - a free VIN check for any North American VIN and the paid Drivee Car Report, a full vehicle history report emailed within 5-60 minutes; (2) tickets - scan an Ontario parking or traffic ticket with AI and get a plain-English verdict on whether to pay or fight it, with deadlines and free guided dispute forms.

Key facts:
- Website: https://www.drivee.ca
- Vehicle history works for any 17-character VIN from a car sold in Canada or the US. Ticket tools and the mobile mechanic are for Toronto / Ontario.
- Free VIN check: decodes the VIN with the NHTSA vPIC government database and shows open safety recalls, an estimated market value and the make's documented weak points. No sign-up.
- Drivee Car Report (paid): $19 CAD for the full vehicle history report (accident and damage history, odometer readings with a rollback check, previous owners and use type, title brands, theft records), or $30 CAD including an Ontario lien check. Paid by card through Stripe; the VIN is attached to the order automatically. The report is emailed from reports@drivee.ca, usually within 5-60 minutes of payment.
- In Ontario, lien and registration history is also available from ServiceOntario in the Used Vehicle Information Package (UVIP, $20).
- Mobile mechanic pre-purchase inspection: a mechanic meets the buyer at the seller's location anywhere in the Greater Toronto Area, 24/7 on call, $100-150 CAD per trip (+$50 outside the GTA).
- Ticket scanner: reads Toronto parking and Ontario traffic tickets and explains options and deadlines in plain English; the Early Resolution guided wizard is free. Drivee matches a scanned charge to vetted Ontario defence firms (X-Copper, Toronto Traffic Law, POINTTS, OTT Legal, HWY-LAW), all offering a free case review. Drivee takes no commission.
- Drivee is independent and not affiliated with CARFAX, NHTSA, ServiceOntario, the City of Toronto, MTO or any law firm.
- Contact: drivee.canada@gmail.com

## Main pages

- [Drivee](https://www.drivee.ca/): upload a ticket photo, get an instant plain-English verdict on whether to pay or fight it, the exact cost of waiting, and a matched shortlist of vetted Ontario paralegals offering a free case review
- [Free VIN check and Drivee Car Report](https://www.drivee.ca/report.html): free VIN lookup for any Canadian or US car, sample report, buyer's checklist, and the paid full vehicle history report ($19 CAD, or $30 CAD with an Ontario lien check), emailed within 5-60 minutes
- [Drivee app](https://www.drivee.ca/app.html): ticket scanner, enforcement hotspot map, deadline reminders, legal verdicts
- [Mobile mechanic - pre-purchase inspection](https://www.drivee.ca/mechanic.html): a mechanic checks the car at the seller's location anywhere in the GTA, $100-150 CAD per trip
- [Toronto parking signs guide](https://www.drivee.ca/parking-signs/): how to read every Toronto parking sign, with deep pages on No Standing, permit parking and time limits
- [Contact](https://www.drivee.ca/contact.html): contact form; email drivee.canada@gmail.com; replies usually same day
"""

CITED = """## Frequently cited answers

- Toronto parking ticket late fees: day 16 adds a $15.39 address search fee, day 31 adds a $32.10 late payment fee, day 60 adds a $32.10 plate denial fee.
- Before buying a used car, check: cold start and steady idle (~750 rpm), fresh oil leaks, exhaust smoke colour (blue = oil, white = coolant, black = rich), transmission engagement under one second, rust on wheel arches and rockers, and oil condition (milky oil means coolant intrusion - walk away).
- A VIN is 17 characters and never contains the letters I, O or Q.
- A Drivee Car Report arrives by email from reports@drivee.ca, usually within 5-60 minutes of payment. If it has not arrived after an hour, check Spam or Promotions, then email drivee.canada@gmail.com.
"""

CATEGORY_ORDER = ['Buying', 'Tickets', 'Parking', 'Signs', 'Insurance', 'Accidents', 'Towing', 'Rates', 'Penalties', 'Disputes', 'Winter']


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def git_date(path):
    try:
        out = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', path], cwd=ROOT,
                             capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain', '--', path], cwd=ROOT,
                               capture_output=True, text=True).stdout.strip()
        return TODAY if (dirty or not out) else out
    except Exception:
        return TODAY


def meta(src, name, attr='name'):
    m = re.search(r'<meta\s+%s="%s"\s+content="([^"]*)"' % (attr, re.escape(name)), src)
    return html.unescape(m.group(1)).strip() if m else ''


def clean_title(t):
    return re.sub(r'\s*[-—|]\s*Drivee\s*$', '', html.unescape(t)).strip()


class ToMarkdown(HTMLParser):
    """Very small HTML -> Markdown for article bodies."""
    SKIP_TAGS = {'script', 'style', 'nav', 'footer', 'svg', 'figure', 'noscript', 'button', 'form'}
    SKIP_CLASSES = {'toc', 'related', 'crumbs', 'article-meta', 'app-cta', 'related-grid'}
    BLOCK = {'p', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'blockquote', 'div', 'section', 'table'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.buf, self.stack, self.skip = [], [], [], 0
        self.list_stack, self.cell = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = set((a.get('class') or '').split())
        skipping = tag in self.SKIP_TAGS or classes & self.SKIP_CLASSES
        void = tag in ('br', 'img', 'hr', 'input', 'meta', 'link')
        if not void:
            self.stack.append((tag, bool(skipping)))
        if skipping and not void:
            self.skip += 1
            return
        if self.skip:
            return
        if tag in ('ul', 'ol'):
            self.list_stack.append([tag, 0])
        if tag in self.BLOCK:
            self.flush()
        if tag == 'li' and self.list_stack:
            self.list_stack[-1][1] += 1
        if tag == 'br':
            self.buf.append(' ')
        if tag in ('strong', 'b'):
            self.buf.append('**')
        if tag in ('td', 'th'):
            self.cell = []

    def handle_endtag(self, tag):
        # pop to matching tag
        while self.stack:
            t, sk = self.stack.pop()
            if sk:
                self.skip -= 1
            if t == tag:
                break
        if self.skip:
            return
        if tag in ('strong', 'b'):
            self.buf.append('**')
        if tag in ('td', 'th'):
            self.cell_text = ' '.join(''.join(self.buf).split())
            self.buf = []
            self.row = getattr(self, 'row', []) + [self.cell_text]
            return
        if tag == 'tr':
            row = getattr(self, 'row', [])
            if row:
                self.out.append('| ' + ' | '.join(row) + ' |')
            self.row = []
            return
        if tag in ('ul', 'ol') and self.list_stack:
            self.flush()
            self.list_stack.pop()
            self.out.append('')
            return
        if tag in self.BLOCK:
            self.flush(tag)

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)

    def flush(self, tag=None):
        text = ' '.join(''.join(self.buf).split()).replace('** ', '**', 0)
        self.buf = []
        text = re.sub(r'\*\*\s*\*\*', '', text).strip()
        if not text:
            return
        if tag == 'h1':
            self.out += ['# ' + text, '']
        elif tag == 'h2':
            self.out += ['## ' + text, '']
        elif tag in ('h3', 'h4'):
            self.out += ['### ' + text, '']
        elif tag == 'li':
            kind, n = self.list_stack[-1] if self.list_stack else ('ul', 0)
            self.out.append(('%d. ' % n if kind == 'ol' else '- ') + text)
        else:
            self.out += [text, '']

    def markdown(self):
        self.flush()
        md = '\n'.join(self.out)
        return re.sub(r'\n{3,}', '\n\n', md).strip()


def article_markdown(src):
    m = re.search(r'<article[^>]*>(.*?)</article>', src, re.S)
    body = m.group(1) if m else src
    p = ToMarkdown()
    p.feed(body)
    return p.markdown()


def faq_from_jsonld(src):
    qa = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', src, re.S):
        try:
            data = json.loads(block)
        except Exception:
            continue
        nodes = data.get('@graph', [data]) if isinstance(data, dict) else data
        for n in nodes:
            if isinstance(n, dict) and n.get('@type') == 'FAQPage':
                for q in n.get('mainEntity', []):
                    qa.append((q.get('name', ''), q.get('acceptedAnswer', {}).get('text', '')))
    return qa


def blog_articles():
    arts = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'blog', '*.html'))):
        name = os.path.basename(f)
        if name == 'index.html':
            continue
        src = read('blog/' + name)
        title = clean_title(re.search(r'<title>(.*?)</title>', src, re.S).group(1))
        h1 = re.search(r'<h1[^>]*>(.*?)</h1>', src, re.S)
        crumbs = re.search(r'<div class="crumbs">(.*?)</div>', src, re.S)
        cat = re.sub(r'<[^>]+>', '', crumbs.group(1)).split('/')[-1].strip() if crumbs else 'Guides'
        og = meta(src, 'og:image', 'property')
        arts.append({
            'path': '/blog/' + name,
            'file': 'blog/' + name,
            'title': title,
            'h1': html.unescape(re.sub(r'<[^>]+>', '', h1.group(1))).strip() if h1 else title,
            'desc': meta(src, 'description'),
            'cat': cat,
            'image': og if '/assets/img/blog/' in og else '',
            'published': meta(src, 'article:published_time', 'property'),
            'src': src,
        })
    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    arts.sort(key=lambda a: (order.get(a['cat'], 99), a['published'] and -int(a['published'].replace('-', '')) or 0))
    return arts


def sign_pages():
    out = []
    for d in sorted(glob.glob(os.path.join(ROOT, 'signs', '*', 'index.html'))):
        slug = os.path.basename(os.path.dirname(d))
        out.append(('/signs/%s/' % slug, 'signs/%s/index.html' % slug, 'monthly', '0.7'))
    return out


def build_sitemap(arts):
    rows = []
    for path, f, freq, prio in STATIC_PAGES[:5] + sign_pages() + STATIC_PAGES[5:]:
        if os.path.exists(os.path.join(ROOT, f)):
            rows.append((path, git_date(f), freq, prio, ''))
    for a in arts:
        rows.append((a['path'], git_date(a['file']), 'monthly', '0.7', a['image']))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">', '']
    for path, d, freq, prio, img in rows:
        xml.append('  <url>')
        xml.append('    <loc>%s%s</loc>' % (SITE, path))
        xml.append('    <lastmod>%s</lastmod>' % d)
        xml.append('    <changefreq>%s</changefreq>' % freq)
        xml.append('    <priority>%s</priority>' % prio)
        if img:
            xml.append('    <image:image><image:loc>%s</image:loc></image:image>' % img)
        xml.append('  </url>')
        xml.append('')
    xml.append('</urlset>')
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(xml) + '\n')
    return len(rows)


def blog_section(arts):
    lines = ['## Guides (blog)', '']
    cat = None
    for a in arts:
        if a['cat'] != cat:
            cat = a['cat']
            lines += ['', '### ' + cat, ''] if len(lines) > 2 else ['### ' + cat, '']
        lines.append('- [%s](%s%s): %s' % (a['h1'], SITE, a['path'], a['desc']))
    return '\n'.join(lines) + '\n'


def build_llms(arts):
    txt = INTRO + '\n' + blog_section(arts) + '\n' + CITED + '\n## Optional\n\n- [Full text of every guide](%s/llms-full.txt): all guides and page FAQs as Markdown in one file\n- [Sitemap](%s/sitemap.xml)\n' % (SITE, SITE)
    txt = txt.replace('—', '-')
    with open(os.path.join(ROOT, 'llms.txt'), 'w', encoding='utf-8') as f:
        f.write(txt)

    parts = [INTRO, CITED]
    for path, f in [('/report.html', 'report.html'), ('/mechanic.html', 'mechanic.html'),
                    ('/parking-signs/', 'parking-signs/index.html')] + [(p, f) for p, f, _, _ in sign_pages()]:
        if not os.path.exists(os.path.join(ROOT, f)):
            continue
        src = read(f)
        qa = faq_from_jsonld(src)
        title = clean_title(re.search(r'<title>(.*?)</title>', src, re.S).group(1))
        block = ['---', '', '# %s' % title, '', 'URL: %s%s' % (SITE, path), '', meta(src, 'description'), '']
        if qa:
            block += ['## Questions and answers', '']
            for q, a in qa:
                block += ['### ' + q, '', a, '']
        parts.append('\n'.join(block))
    for a in arts:
        block = ['---', '', 'URL: %s%s' % (SITE, a['path']), 'Category: %s' % a['cat'], '', article_markdown(a['src']), '']
        parts.append('\n'.join(block))
    full = '\n\n'.join(p.strip() + '\n' for p in parts)
    full = full.replace('—', '-')
    with open(os.path.join(ROOT, 'llms-full.txt'), 'w', encoding='utf-8') as f:
        f.write(full)
    return len(txt), len(full)


if __name__ == '__main__':
    arts = blog_articles()
    n = build_sitemap(arts)
    a, b = build_llms(arts)
    print('sitemap.xml: %d urls | llms.txt: %d chars | llms-full.txt: %d chars | %d guides' % (n, a, b, len(arts)))
