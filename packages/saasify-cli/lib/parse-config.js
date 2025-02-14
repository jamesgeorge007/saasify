'use strict'

const Ajv = require('ajv')
const fs = require('fs-extra')
const isDirectory = require('is-directory')
const path = require('path')
const parseJson = require('parse-json')
const semver = require('semver')
const { validators } = require('saasify-utils')
const yaml = require('js-yaml')

const configSchema = require('./schemas/config.schema')

const ajv = new Ajv({ useDefaults: true })
const validateConfig = ajv.compile(configSchema)

module.exports = (program) => {
  const base = path.resolve(program.config || '')

  if (!fs.pathExistsSync(base)) {
    throw new Error(`Unable to find config file "${program.config}"`)
  }

  const jsonConfigFilePath = isDirectory.sync(base)
    ? path.join(base, 'saasify.json')
    : base

  const yamlConfigFilePath = isDirectory.sync(base)
    ? path.join(base, 'saasify.yml')
    : base

  let configFilePath
  let fileType

  if (fs.pathExistsSync(jsonConfigFilePath)) {
    configFilePath = jsonConfigFilePath
    fileType = 'json'
  } else if (fs.pathExistsSync(yamlConfigFilePath)) {
    configFilePath = yamlConfigFilePath
    fileType = 'yaml'
  } else {
    throw new Error(`Unable to find config file "${jsonConfigFilePath}"`)
  }

  const configLabel = path.relative(process.cwd(), configFilePath)
  console.error(`parsing config ${configLabel}`)

  const configData = fs.readFileSync(configFilePath, 'utf8')
  const config =
    fileType === 'json'
      ? parseJson(configData, configLabel)
      : yaml.safeLoad(configData)
  validateConfig(config)

  if (validateConfig.errors) {
    throw new Error(`Invalid config: ${ajv.errorsText(validateConfig.errors)}`)
  }

  config.root = path.dirname(configFilePath)

  // ensure the config has a valid project name
  if (program.project) {
    config.name = program.project
  } else if (!config.name) {
    config.name = path.basename(config.root)
  }

  if (!config.name) {
    throw new Error('Missing config name')
  }

  if (!validators.projectName(config.name)) {
    throw new Error(
      `Invalid config name [${config.name}] (regex ${validators.projectNameRe})`
    )
  }

  if (config.saasifyVersion !== 1) {
    throw new Error(`Invalid config saasifyVersion "${config.saasifyVersion}"`)
  }

  if (!semver.valid(config.version)) {
    throw new Error(`Invalid config semver version "${config.version}"`)
  }

  if (!config.services || !config.services.length) {
    throw new Error('Invalid config, must contain at least one service')
  }

  // these properties should apply to each service
  const { headers, immutable } = config
  delete config.headers
  delete config.immutable

  for (const service of config.services) {
    if (service.name && !validators.service(service.name)) {
      throw new Error(
        `Invalid config service "name" [${service.name}] (must be a valid JavaScript identifier regex ${validators.serviceRe})`
      )
    }

    if (immutable && service.immutable === undefined) {
      service.immutable = true
    }

    if (headers) {
      service.headers = {
        ...headers,
        ...service.headers
      }
    }

    if (service.headers) {
      const headers = Object.entries(service.headers)

      // ensure that all headers are normalized to lower-case
      service.headers = headers.reduce((acc, [key, value]) => {
        acc[key.toLowerCase()] = value
      }, {})
    }
  }

  return config
}
