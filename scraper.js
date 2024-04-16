require("dotenv").config();
const puppeteer = require("puppeteer");
const pool = require("./db");
const queries = require("./Queries/queries");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const {
  ToadScheduler,
  SimpleIntervalJob,
  AsyncTask,
} = require("toad-scheduler");

const scheduler = new ToadScheduler();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

async function sendMail(token, toAddress, cardName, cardLink) {
  try {
    const access_token = token;
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "deckdexautomated@gmail.com",
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        refreshToken: REFRESH_TOKEN,
        accessToken: access_token,
      },
    });

    const mailOptions = {
      from: "deckdexautomated@gmail.com",
      to: `${toAddress}`,
      subject: `${cardName} is now available on trollandtoad.com`,
      text: `Find ${cardName} on trollandtoad.com with the link below\n${cardLink}`,
    };

    const result = await transport.sendMail(mailOptions);
    return result;
  } catch (e) {
    return e;
  }
}

const task = new AsyncTask(
  "simple task",
  async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    //get the last page number to know how many times to iterate through search
    await page.goto("https://www.trollandtoad.com/yugioh/all-singles/7087");

    const lastPage = await page.evaluate(() => {
      return document
        .getElementsByClassName("lastPage")[0]
        .getAttribute("data-page");
    });

    pool.query(queries.deleteOldCards, [0], (error, result) => {
      if (error) throw error;
    });

    for (let i = 1; i < lastPage; i++) {
      await page.goto(
        `https://www.trollandtoad.com/yugioh/all-singles/7087?Keywords=&min-price=&max-price=&items-pp=60&item-condition=&selected-cat=7087&sort-order=&page-no=${i}&view=list&subproduct=0`
      );

      let nodeList = await page.evaluate(() => {
        const nodeArr = Array.from(document.querySelectorAll(".card > .row "));

        function extractSrc(rawStr) {
          const rx = / src="([^"]*([^"]*(?:[^\\"]|\\\\|\\")*)+)"/gi;
          const arr = rx.exec(rawStr);

          if (arr.length > 0) return arr[0];
          return "";
        }

        function extractHref(rawStr) {
          const rx = / href="([^"]*([^"]*(?:[^\\"]|\\\\|\\")*)+)"/gi;
          const arr = rx.exec(rawStr);

          if (arr.length > 0) return arr[0];
          return "";
        }

        let objArr = nodeArr.map((node) => {
          let obj = {};

          if (node.children[0].className.includes("prod-img-container")) {
            let innerHtml = node.children[0].innerHTML.trim();
            let rawSrc = extractSrc(innerHtml);
            obj.imageSource = rawSrc.substring(6, rawSrc.indexOf(".jpg") + 4);
            let rawLink = extractHref(innerHtml);
            let path = rawLink.substring(6);
            let root = `https://trollandtoad.com`;
            obj.link = `${root}${path}`;
          }

          if (node.children[1].className.includes("product-info")) {
            let innerText = node.children[1].innerText;
            let splitIndex = innerText.indexOf("\n");
            obj.name = innerText.substring(0, splitIndex);
            obj.edition = innerText.substring(splitIndex + 1);
          }

          if (node.children[3].className.includes("buying-options-container")) {
            let innerHtml = node.children[3].innerHTML;

            let prices = [];
            for (let i = 0; i < innerHtml.length - 1; i++) {
              if (innerHtml[i] === "$") {
                let substr = innerHtml.substring(i, i + 7).trim();
                let cutOff = substr.indexOf("<");
                let str = substr.substring(0, cutOff);
                let price = { price: str, sourcesite: "Troll and Toad" };
                prices.push(price);
              }
            }

            obj.prices = Array.from(new Set(prices));
          }

          return obj;
        });

        return objArr;
      });

      //filter items that arent cards ex. deck boxes etc...
      nodeList = nodeList.filter((item) => {
        if (item.name.trim().toLowerCase().includes("edition")) {
          return item;
        }
        if (item.name.trim().toLowerCase().includes("en0")) {
          return item;
        }
      });

      for (let i = 0; i < nodeList.length - 1; i++) {
        let values = [
          nodeList[i].name,
          nodeList[i].imageSource,
          nodeList[i].edition,
          nodeList[i].prices,
          nodeList[i].link,
        ];
        pool.query(queries.insertCards, values, (error, result) => {
          if (error) throw error;
        });
      }

      //get googleapis access token for emails
      const access_token = await oAuth2Client.getAccessToken();

      pool.query(queries.getAllWatchLists, (error, result) => {
        if (error) throw error;

        const checkWordArray = (wordArr, cardName, count = 0) => {
          for (let i = 0; i < wordArr.length - 1; i++) {
            if (cardName.toLowerCase().includes(wordArr[i].toLowerCase())) {
              count++;
            }
          }
          if (count === wordArr.length - 1) {
            return true;
          } else {
            return false;
          }
        };

        result.rows.forEach((user) => {
          user.watchlist.forEach((item) => {
            const wordArr = item.trim().split(" ");
            for (let i = 0; i < nodeList.length - 1; i++) {
              if (checkWordArray(wordArr, nodeList[i].name)) {
                link = nodeList[i].link.replace(/"/gi, "");
                sendMail(access_token, user.email, nodeList[i].name, link).then(
                  () => console.log("mail sent")
                );
              }
            }
          });
        });
      });
      console.log(`finished page ${i}`);
    }
    await browser.close();
  },
  (err) => {
    console.log(err);
  }
);

const job = new SimpleIntervalJob({ hours: 2, runImmediately: true }, task);

scheduler.addSimpleIntervalJob(job);
