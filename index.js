const express = require('express');
const puppeteer = require('puppeteer');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const { parse } = require('json2csv');

const app = express();
const PORT = 3000;

const baseUrl = 'https://gemstonecabochon.com/gemstone-shop/admin/index.php?route=catalog/product&page=';
const USERNAME = 'John.O';
const PASSWORD = 'aventure2';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 100, max = 500) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function moveMouseHumanLike(page, selector) {
  const element = await page.$(selector);
  if (!element) return;
  const box = await element.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2 + randomDelay(-5, 5);
  const y = box.y + box.height / 2 + randomDelay(-5, 5);
  await page.mouse.move(x, y, { steps: randomDelay(5, 15) });
  await sleep(randomDelay(200, 600));
}

function extractProductsFromHTML(html, pageNum) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const rows = Array.from(document.querySelectorAll('table.table-bordered tbody tr'));
  return rows.map(row => {
    const tds = row.querySelectorAll('td');

    const productId = tds[0]?.querySelector('input')?.value || '';
    const img = tds[1]?.querySelector('img')?.src || '';
    const name = tds[2]?.textContent.trim();
    const ref = tds[3]?.textContent.trim();
    const price = parseFloat(tds[4]?.textContent.trim()) || 0;
    const quantityText = tds[5]?.querySelector('.label')?.textContent.trim();
    const quantity = parseInt(quantityText) || 0;
    const status = tds[6]?.textContent.trim();
    const editLink = tds[7]?.querySelector('a')?.href || '';

    return {
      page: pageNum,
      product_id: productId,
      image: img,
      name,
      ref,
      price,
      quantity,
      status,
      edit_link: editLink,
    };
  });
}

app.get('/scrape', async (req, res) => {
  const start = parseInt(req.query.start);
  const end = parseInt(req.query.end);

  if (isNaN(start) || isNaN(end) || start > end) {
    return res.status(400).json({ error: 'Invalid start or end parameter' });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();
  const results = [];

  try {
    for (let i = start; i <= end; i++) {
      const url = `${baseUrl}${i}`;
      console.log(`\n🔗 Opening page ${i}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(randomDelay(1000, 2000));

      const needsLogin = await page.$('#input-username');
      if (needsLogin) {
        console.log('🔐 Login required, logging in...');

        await moveMouseHumanLike(page, '#input-username');
        await page.click('#input-username');
        await sleep(randomDelay());
        await page.keyboard.type(USERNAME, { delay: randomDelay(70, 120) });

        await moveMouseHumanLike(page, '#input-password');
        await page.click('#input-password');
        await sleep(randomDelay());
        await page.keyboard.type(PASSWORD, { delay: randomDelay(70, 120) });

        await moveMouseHumanLike(page, 'button[type="submit"]');
        await Promise.all([
          page.click('button[type="submit"]'),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        console.log('✅ Logged in');
      }

      const html = await page.content();
      const products = extractProductsFromHTML(html, i);
      console.log(`📦 Found ${products.length} products on page ${i}`);

      for (let product of products) {
        console.log(`🔍 Scraping details for product ${product.product_id}...`);
        await page.goto(product.edit_link, { waitUntil: 'networkidle2' });
        await sleep(randomDelay(1000, 1500));

        const productDetails = await page.evaluate(() => {
          const getValue = selector => document.querySelector(selector)?.value?.trim() || '';
          const getText = selector => document.querySelector(selector)?.textContent?.trim() || '';

          return {
            name: getValue('#input-name1'),
            description: document.querySelector('#input-description1')?.value || '',
            meta_title: getValue('#input-meta-title1'),
            meta_description: document.querySelector('#input-meta-description1')?.value || '',
            meta_keyword: document.querySelector('#input-meta-keyword1')?.value || '',
            tags: getValue('#input-tag1'),
            model: getValue('#input-model'),
            sku: getValue('#input-sku'),
            price: getValue('#input-price'),
            quantity: getValue('#input-quantity'),
            length: getValue('#input-length'),
            width: getValue('#input-width'),
            height: getValue('#input-height'),
            weight: getValue('#input-weight'),
            seo_keyword: getValue('#input-keyword'),
            date_available: getValue('#input-date-available'),
            image_main: document.querySelector('#thumb-image img')?.src || '',
            extra_images: Array.from(document.querySelectorAll('#images img')).map(img => img.src).join(', ')
          };
        });

        results.push({ ...product, ...productDetails });
        await sleep(randomDelay(1500, 2500));
      }
    }

    console.log(`\n✅ Done! Total detailed products: ${results.length}`);

    const csv = parse(results);
    fs.writeFileSync('scraped_products.csv', csv);
    console.log('📁 CSV file saved as scraped_products.csv');

    res.json({ success: true, pages_scraped: `${start} to ${end}`, count: results.length, file: 'scraped_products.csv' });

  } catch (err) {
    console.error(`🔥 Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`👉 Try: http://localhost:${PORT}/scrape?start=1&end=1`);
});
