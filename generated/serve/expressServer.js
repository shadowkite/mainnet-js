// const { Middleware } = require('swagger-express-middleware');
const http = require('http');
const fs = require('fs');
const path = require('path');
const swaggerUI = require('swagger-ui-express');
const jsYaml = require('js-yaml');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { OpenApiValidator } = require('express-openapi-validator');
const logger = require('./logger');
const timeout = require('connect-timeout');
const config = require('./config');
const mainnet = require('mainnet-js');
const setupRateLimits = require('./rateLimits');

const makeWsServer = require('./wsServer');

class ExpressServer {
  constructor(port, openApiYaml, docYaml) {
    this.port = port;
    this.app = express();
    this.openApiPath = openApiYaml;
    this.docPath = docYaml;
    try {
      this.schema = jsYaml.safeLoad(fs.readFileSync(openApiYaml));
      this.docSchema = jsYaml.safeLoad(fs.readFileSync(docYaml).toString());
    } catch (e) {
      logger.error('failed to start Express Server', e.message);
    }
    this.setupMiddleware();
  }

  setupMiddleware() {
    // this.setupAllowedMedia();
    this.app.use(cors());
    const latest = fs.readdirSync(__dirname + '/node_modules/mainnet-js/dist/').filter(val => val.match(/mainnet-\d+\.\d+.\d+.js$/)).pop();
    this.app.use('/scripts/mainnet.js', express.static(__dirname + `/node_modules/mainnet-js/dist/${latest}`));
    this.app.use(express.static(__dirname + '/static'));
    this.app.use(bodyParser.json({ limit: '15MB' }));
    this.app.use(express.json());
    this.app.use(timeout(`${config.TIMEOUT}s`));
    this.app.use(express.urlencoded({ extended: false }));
    //this.app.use(cookieParser());
    //Simple test to see that the server is up and responding
    this.app.get("/ready", (req, res) => {
      res.status(200);
      res.json({ "status": "okay" });
    });
    //Send the openapi document *AS GENERATED BY THE GENERATOR*
    this.app.get('/openapi', (req, res) => res.sendFile((path.join(__dirname, "../../swagger/v1/", "api.yml"))));
    //View the openapi document in a visual interface. Should be able to test from this page
    this.app.get('/', (req, res) => {
      res.redirect(301, '/api-docs');
    });

    this.app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(this.docSchema));
    this.app.get("/timeout", (req, res) => {});
    this.app.get('/login-redirect', (req, res) => {
      res.status(200);
      res.json(req.query);
    });
    this.app.get('/oauth2-redirect.html', (req, res) => {
      res.status(200);
      res.json(req.query);
    });

    setupRateLimits(this.app);
  }

  async launch() {
    return new OpenApiValidator({
      apiSpec: this.openApiPath,
      operationHandlers: path.join(__dirname),
      fileUploader: { dest: config.FILE_UPLOAD_PATH },
      validateSecurity: config.API_KEY ? {
        handlers: {
          bearerAuth: (req, scopes, schema) => {
            if (!req.headers.authorization || req.headers.authorization.split(" ")[0].toLowerCase() != "bearer") {
              throw { status: 401, message: 'No bearer authorization header provided' };
            }

            const token = req.headers.authorization.split("bearer ")[1];

            if (config.API_KEY !== token) {
              throw { status: 403, message: 'forbidden' };
            }

            return true;
          }
        }
      } : false
    }).install(this.app)
      .catch(e => console.log(e))
      .then(async () => {
        // eslint-disable-next-line no-unused-vars
        this.app.use((err, req, res, next) => {
          // format errors
          res.status(err.status || 500).json({
            message: err.message || err.error,
            errors: err.errors || '',
          });
        });
        setTimeout(async () => {
          await mainnet.initProviders();
        }, 0);
        const server = this.app.listen(this.port);
        const wsServer = makeWsServer(server);
        server.on('upgrade', (request, socket, head) => {
          wsServer.handleUpgrade(request, socket, head, socket => {
            wsServer.emit('connection', socket, request);
          });
        });
        server.on('close', () => {
          wsServer.close();
        });

        server.app = this.app;
        this.server = server;
        return server;
      }).catch(error => {
        console.warn(error)
      });
  }

  async close() {
    await mainnet.disconnectProviders();
    if (this.server !== undefined) {
      await this.server.close();
      // console.log(`Server on port ${this.port} shut down`);
    }
  }
}

module.exports = ExpressServer;
