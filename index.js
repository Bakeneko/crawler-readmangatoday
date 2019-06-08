'use strict'
const requestp = require('request-promise')
const cheerio = require('cheerio')
const utils = require('./utils')

const baseUrl = 'https://www.readmng.com'
const mangaListUrl = baseUrl + '/manga-list'
const releasesUrl = baseUrl + '/latest-releases'

class ReadMangaTodayCrawler {
  constructor (options) {
    options = options || {}
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36'
  }

  async getMangaList () {
    const letters = ['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 't', 'u', 'v', 'w', 'x', 'y', 'z']

    let list = []
    for (let letter of letters) {
      let sublist
      let error
      let tries = 0
      while (tries++ < 3) {
        try {
          // fetch mangas for letter
          sublist = await this.getMangaListForLetter(letter)
          break
        } catch (err) {
          error = err
        }
      }
      if (sublist === undefined) {
        throw new Error(`Error getting manga list for letter "${letter}": ${error}`)
      }
      list.push(...sublist)
    }

    return list
  }

  async getMangaListForLetter (letter) {
    const headers = {
      'User-Agent': this.userAgent
    }

    // send request
    const $ = await requestp({
      method: 'GET',
      uri: mangaListUrl + '/' + letter,
      headers: headers,
      transform: cheerio.load
    })

    // parse results
    let mangas = []
    $('div.manga-list-box span.manga-item a').each((i, el) => {
      const anchor = $(el)
      const href = anchor.attr('href')
      mangas.push({
        sourceId: href.substr(href.lastIndexOf('/') + 1),
        name: utils.trimSpaces(anchor.attr('title')),
        url: href
      })
    })

    return mangas
  }

  async getReleases (from) {
    if (from && !(from instanceof Date)) {
      throw new Error('from should be a date')
    }

    let list = []
    let currentIndex = 0
    let stop = false
    while (!stop) {
      let sublist
      let error
      let tries = 0
      while (tries++ < 3) {
        try {
          // fetch releases for index
          sublist = await this.getReleasesForIndex(currentIndex)
          break
        } catch (err) {
          error = err
        }
      }

      if (sublist === undefined) {
        throw new Error(`Error getting release list for index ${currentIndex}: ${error}`)
      }

      // check for fresh releases
      if (from) {
        sublist = sublist.filter(m => {
          if (new Date(m.updatedAt).getTime() < from.getTime()) {
            stop = true
            return false
          }
          return true
        })
      }

      list.push(...sublist)
      currentIndex++
    }

    return list
  }

  async getReleasesForIndex (index) {
    const headers = {
      'User-Agent': this.userAgent
    }

    // send request
    const $ = await requestp({
      method: 'GET',
      uri: releasesUrl + '/' + index,
      headers: headers,
      transform: cheerio.load
    })

    // parse results
    let list = []
    $('div.manga_updates dl').each((i, el) => {
      const elem = $(el)
      const anchor = elem.find('dt a.manga_info').first()
      const href = anchor.attr('href')
      let manga = {
        sourceId: href.substr(href.lastIndexOf('/') + 1),
        name: utils.trimSpaces(anchor.attr('title')),
        url: href
      }
      let time = utils.trimSpaces(elem.find('dt span.time').first().text())
      const dateParts = time.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/)
      manga.updatedAt = new Date(dateParts[3], dateParts[2] - 1, dateParts[1])
      let chapters = []
      elem.find('dd a').each((i, el) => {
        const anchor = $(el)
        chapters.push({
          name: utils.trimSpaces(anchor.text()),
          url: anchor.attr('href')
        })
      })
      manga.updatedChapters = chapters.map(chap => {
        return {
          sourceId: `${manga.sourceId}/${chap.url.substr(chap.url.lastIndexOf('/') + 1)}`,
          name: chap.name,
          url: chap.url,
          updatedAt: manga.updatedAt
        }
      })
      manga.updatedChaptersCount = manga.updatedChapters.length

      list.push(manga)
    })

    return list
  }

  async getManga (id) {
    if (!id) {
      throw new Error('manga id required')
    }

    const headers = {
      'User-Agent': this.userAgent
    }

    // send request
    const $ = await requestp({
      method: 'GET',
      uri: baseUrl + '/' + id,
      headers: headers,
      transform: cheerio.load
    })

    // parse results
    let elem = $('div.content-list').first()
    let metaDiv = elem.find('div.row.movie-meta').first()
    let manga = {
      id,
      name: utils.trimSpaces(metaDiv.find('div.panel-heading h1').first().text()),
      description: metaDiv.find('ul.list-group > li.list-group-item.movie-detail > p').first().text(),
      thumbnail: metaDiv.find('div.col-md-3 > img').first().attr('src')
    }

    manga.aliases = metaDiv.find('dl dd:nth-of-type(1)').first().text()
      .split(',')
      .map(str => utils.trimSpaces(str))

    let status = metaDiv.find('dl dd:nth-of-type(2)').first().text().toLowerCase()
    manga.status = 'unknown'
    if (status === 'ongoing') {
      manga.status = 'ongoing'
    } else if (status === 'completed') {
      manga.status = 'completed'
    }

    manga.tags = []
    metaDiv.find('dl dd:nth-of-type(3) a').each((i, el) => {
      const anchor = $(el)
      const href = anchor.attr('href')
      manga.tags.push({
        sourceId: href.substr(href.lastIndexOf('/') + 1),
        name: utils.trimSpaces(anchor.text()),
        url: href
      })
    })

    manga.tags.push({
      name: utils.trimSpaces(metaDiv.find('dl dd:nth-of-type(4)').first().text())
    })

    manga.views = parseInt(metaDiv.find('dl dd:nth-of-type(5)').first().text().replace(',', ''))

    manga.authors = []
    const authorsDiv = elem.find('div.row.cast').first()
    authorsDiv.find('ul.cast-list li.director').each((i, el) => {
      const elem = $(el)
      const anchor = elem.find('ul li a').first()
      const href = anchor.attr('href')
      manga.authors.push({
        sourceId: href.substr(href.lastIndexOf('/') + 1),
        name: utils.trimSpaces(anchor.text()),
        thumbnail: elem.find('a img').first().attr('src'),
        url: href,
        role: utils.trimSpaces(elem.find('ul li:nth-of-type(2)').first().text())
      })
    })

    manga.chapters = []
    const chaptersDiv = elem.find('#chapters_container').first()
    chaptersDiv.find('ul.chp_lst li a').each((i, el) => {
      const anchor = $(el)
      const href = anchor.attr('href')
      manga.chapters.push({
        sourceId: href.substr(href.lastIndexOf('/') + 1),
        name: utils.trimSpaces(anchor.find('span.val').first().text()),
        url: href,
        updatedAt: utils.parseDateAgo(utils.trimSpaces(anchor.find('span.dte').first().text()))
      })
    })

    let index = 0
    manga.chapters = manga.chapters.reverse()
    for (let chap of manga.chapters) {
      chap.index = index++
    }

    let chapNumbers = []
    let hasIssues = false
    for (let chap of manga.chapters) {
      chap.number = utils.parseChapterNumber(chap.name, manga.name)
      if (chap.number >= 0 && chapNumbers[chap.number]) {
        hasIssues = true
        break
      }
      chapNumbers[chap.number] = true
    }
    if (hasIssues) {
      for (let chap of manga.chapters) {
        chap.number = -1
      }
    }
    manga.chaptersCount = manga.chapters.length

    return manga
  }
}

module.exports = ReadMangaTodayCrawler
