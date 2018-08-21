# delion-curl-remote

Delion:API Patch to override the attachToTangle behaviour of iota.js

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/delionAPI/delion-curl-remote/master/LICENSE) 

---

## Getting started

### Installation

Install using [npm](https://www.npmjs.org/):
```
npm install delion-curl-remote
```

### Patch attachToTangle function

```js
const delionCurl = require('delion-curl-remote');
//... import IOTA lib
//... import IOTA validators
//... import IOTA transaction-converter

//... init IOTA Client

//patch attachToTagle
delionCurl(iotaClient,iotaValidators,transactionConverter, delionUser,delionPassword);

//bind overriden ATT function
const attachToTangle =iotaClient.attachToTangle

//... use IOTA Client

```

## Documentation

Documentation of Delion:API (https://delion.io) can be found on [docs.delion.io](https://socs.delion.io).
Documentation of IOTA protocol and [`IRI`](https://github.com/iotaledger/iri) http API can be found on [docs.iota.works](https://docs.iota.works).

## Copy

This repo is a modified copy of the "Curl Remote - IOTA.js Library Shim"(https://gitlab.com/iota-foundation/software/powbox/curl-remote). We thank the developers for the preliminary work

## Reporting Issues

Please report any problems you encouter during development by [opening an issue](https://github.com/delionAPI/delion-curl-remote/issues/new).

## Announcements

Stay up to date and follow us at (https://twitter.com/delion_io)

## Join the discussion

Suggestions and discussion around specs, standardization and enhancements are highly encouraged.
You are invited to join the discussion on [IOTA Discord](https://discord.gg/DTbJufa).

