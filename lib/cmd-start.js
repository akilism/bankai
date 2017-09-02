var gzipMaybe = require('http-gzip-maybe')
var gzipSize = require('gzip-size')
var getPort = require('getport')
var pump = require('pump')

var Router = require('./regex-router')
var http = require('./http-server')
var bankai = require('../')
var ui = require('./ui')

var files = [
  'assets',
  'document',
  'script',
  'manifest',
  'style',
  'service-worker'
]

module.exports = start

function start (entry, opts) {
  var quiet = !!opts.quiet
  var compiler = bankai(entry)
  var router = new Router()
  var state = {
    files: {},
    size: 0
  }

  files.forEach(function (filename) {
    state.files[filename] = {
      name: filename,
      progress: 0,
      timestamp: '        ',
      size: 0,
      status: 'pending',
      done: false
    }
  })

  if (!quiet) var render = ui(state)
  compiler.on('error', function (error) {
    state.error = error.message + error.stack
    if (!quiet) render()
  })

  compiler.on('change', function (nodeName, edgeName, nodeState) {
    var node = nodeState[nodeName][edgeName]
    var data = {
      name: nodeName,
      progress: 100,
      timestamp: time(),
      size: 0,
      status: 'done',
      done: true
    }
    state.files[nodeName] = data

    // Only calculate the gzip size if there's a buffer. Apparently zipping
    // an empty file means it'll pop out with a 20B base size.
    if (node.buffer.length) {
      gzipSize(node.buffer, function (err, size) {
        if (err) data.size = node.buffer.length
        else data.size = size
        if (!quiet) render()
      })
    }
    if (!quiet) render()
  })

  router.route(/^\/manifest.json$/, function (req, res, params) {
    compiler.manifest(function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      res.setHeader('content-type', 'application/json')
      gzip(node.buffer, req, res)
    })
  })

  router.route(/\/(service-worker\.js)|(\/sw\.js)$/, function (req, res, params) {
    compiler.serviceWorker(function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      res.setHeader('content-type', 'application/javascript')
      gzip(node.buffer, req, res)
    })
  })

  router.route(/\/([a-zA-Z0-9-_]+)\.js$/, function (req, res, params) {
    var name = params[1]
    compiler.script(name, function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      res.setHeader('content-type', 'application/javascript')
      gzip(node.buffer, req, res)
    })
  })

  router.route(/\/bundle.css$/, function (req, res, params) {
    compiler.style(function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      res.setHeader('content-type', 'text/css')
      gzip(node.buffer, req, res)
    })
  })

  router.route(/^\/assets\/(.*)$/, function (req, res, params) {
    var prefix = 'assets' // TODO: also accept 'content'
    var name = prefix + '/' + params[1]
    compiler.asset(name, function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      gzip(node.buffer, req, res)
    })
  })

  router.default(function (req, res) {
    var url = req.url
    compiler.document(url, function (err, node) {
      if (err) {
        res.statusCode = 404
        return res.end(err.message)
      }
      res.setHeader('content-type', 'text/html')
      gzip(node.buffer, req, res)
    })
  })

  // Start listening on an unused port.
  var server = http.createServer(function (req, res) {
    if (req.type === 'OPTIONS') return cors(req, res)
    router.match(req, res)
  })
  getPort(8080, 9000, function (err, port) {
    if (err) state.error = err
    server.listen(port, function () {
      state.port = port
    })
  })
}

function gzip (buffer, req, res) {
  var zipper = gzipMaybe(req, res)
  pump(zipper, res)
  zipper.end(buffer)
}

function time () {
  var date = new Date()
  var hours = numPad(date.getHours())
  var minutes = numPad(date.getMinutes())
  var seconds = numPad(date.getSeconds())
  return `${hours}:${minutes}:${seconds}`
}

function numPad (num) {
  if (num < 10) num = '0' + num
  return num
}

function cors (req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-credentials', 'true')
  res.end(200)
}