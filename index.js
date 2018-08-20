const MAX_TIMESTAMP_VALUE = (Math.pow(3,27) - 1) / 2 // from curl.min.js

let fetch = {}
if (typeof window === 'undefined') {
    fetch = require('node-fetch')
} else {
    fetch = window.fetch
}
	

const delionPatchIOTA = (iotaInstance, iotaValidators,transactionConverter, delionUsername,delionPassword) => {
    // Save delion API-URL
	if(!iotaInstance.delionUrl)iotaInstance.delionUrl = 'https://api.delion.io/services/pow'
	// Save delion Host
	if(!iotaInstance.delionHost)iotaInstance.delionHost = 'api.delion.io'
	// Save delion Protocol
	if(!iotaInstance.delionProtocol)iotaInstance.delionProtocol = 'https:'
	//Save Delion userName
	iotaInstance.delionUsername = delionUsername 
	//Save Delion userName
	iotaInstance.delionPassword = delionPassword
	//Init delion token 
	if(!iotaInstance.delionToken) iotaInstance.delionToken = null
	//save loop protection
	if(iotaInstance.delionLoopFuse==null) iotaInstance.delionLoopFuse=true
	//Save break-loop-counter
	if(!iotaInstance.delionBreakLoopCounter) iotaInstance.delionBreakLoopCounter=10
	//Save Authorization URL
	if(!iotaInstance.authorizationUrl) iotaInstance.authorizationUrl='https://api.delion.io/auth/authorize'
	// Save validators
    iotaInstance.valid = iotaValidators
	// Save transactionConverters
	iotaInstance.transactionConverter=transactionConverter
    // Save Delay
    if(!iotaInstance.delionGetPowDelay) iotaInstance.delionGetPowDelay = 3000
	
    // Leave old call accessible
    iotaInstance.oldAttachToTangle = iotaInstance.attachToTangle
    // Override the attachToTangle call
    iotaInstance.attachToTangle = async (
        trunk,
        branch,
        mwm,
        trytes,
        callback
    ) => {
        // Validate all the things!
        validate(iotaInstance, trunk, branch, mwm, trytes, callback)
		
        // Send ATT call to the delion
		let tangleTrytes = await delionATT(
            trunk,
            branch,
            mwm,
            trytes,
            iotaInstance
        )		
		return tangleTrytes
    }
}

// Call the delionATT
const delionATT = async (trunkTransaction, branchTransaction, mwm, trytes, iotaInstance) => {
	
	const iotaObj = iotaInstance;
	
	var finalBundleTrytes = [];
	var previousTxHash;
	var i = 0;

	async function loopTrytes() {
		let transtrytes=await getBundleTrytes(trytes[i])
		i++;
		if (i < trytes.length) {
			await loopTrytes();
		} else {
			// reverse the order so that it's ascending from currentIndex
			return finalBundleTrytes.reverse();
		}
	}

	async function getBundleTrytes(thisTrytes, callback) {
		// PROCESS LOGIC:
		// Start with last index transaction
		// Assign it the trunk / branch which the user has supplied
		// IF there is a bundle, chain  the bundle transactions via
		// trunkTransaction together

		var txObject = iotaObj.transactionConverter.asTransactionObject(thisTrytes);
		txObject.tag = txObject.obsoleteTag;
		txObject.attachmentTimestamp = Date.now();
		txObject.attachmentTimestampLowerBound = 0;
		txObject.attachmentTimestampUpperBound = MAX_TIMESTAMP_VALUE;
		// If this is the first transaction, to be processed
		// Make sure that it's the last in the bundle and then
		// assign it the supplied trunk and branch transactions
		if (!previousTxHash) {
			// Check if last transaction in the bundle
			if (txObject.lastIndex !== txObject.currentIndex) {
				throw new Error("Wrong bundle order. The bundle should be ordered in descending order from currentIndex");
			}

			txObject.trunkTransaction = trunkTransaction;
			txObject.branchTransaction = branchTransaction;
		} else {
			// Chain the bundle together via the trunkTransaction (previous tx in the bundle)
			// Assign the supplied trunkTransaciton as branchTransaction
			txObject.trunkTransaction = previousTxHash;
			txObject.branchTransaction = trunkTransaction;
		}
		var newTrytes = iotaObj.transactionConverter.asTransactionTrytes(txObject);
		
		const nonce =await executeDelionPoW(iotaObj,newTrytes,mwm)
		var returnedTrytes =nonce
		var newTxObject= iotaObj.transactionConverter.asTransactionObject(returnedTrytes);

		// Assign the previousTxHash to this tx
		var txHash = newTxObject.hash;
		previousTxHash = txHash;

		finalBundleTrytes.push(returnedTrytes);
		
	}
	await loopTrytes()
	return finalBundleTrytes
}

function waitFor(ms){
	return new Promise(r=> setTimeout(r,ms));
}

const executeDelionPoW=async (iotaInstance,trytes,minWeightMagnitude) => {

	const payload = {
        trytes: trytes,
        minWeightMagnitude: minWeightMagnitude
    }
    // Create Request Object
    let params = {
		protocol: iotaInstance.delionProtocol,
		hostname: iotaInstance.delionHost,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    }
	
    // Post job to delion
	let loopcounter=0;
	let submittedJobId
	let submittedJobChecker = async () => {
		loopcounter++;
		if(iotaInstance.delionLoopFuse && loopcounter>iotaInstance.delionBreakLoopCounter)throw new Error('Loop probs?')
		//add auth
		params.headers['Authorization'] = iotaInstance.delionToken
		let response = await fetch(iotaInstance.delionUrl, params)
		switch (response.status) {
			case 201:
				// ok, job submitted. Get jobid
				let jobIdLocation=response.headers.raw()['content-location'][0]
				return jobIdLocation
				break;
			case 401: case 403:
				// not authorized or token expired
				let tokenId = await delionAuth(
					iotaInstance
				)
				//set global token
				iotaInstance.delionToken=tokenId
				await waitFor(200)
				return await submittedJobChecker()
				break;
			case 423: case 429:
				// locked or too busy. No free queues or delion:api is busy
				await waitFor(2000)
				return await submittedJobChecker()
				break;
			default:
				// errors 400,500,502
				throw new Error(response.status+":"+response.statusText)
				break;
		}
	}
	
	//await waitFor(5000)
	let jobId= await submittedJobChecker()

	//get response trytes
    let returnTrytes= await delionGetJobTrytes(iotaInstance,jobId)

	return returnTrytes
}

const delionGetJobTrytes=async (iotaInstance,jobId) =>{
	
	let loopcounter=0;
	let jobCompletionTaskId
	let jobCompletionChecker = async () => {
		loopcounter++;
		if(iotaInstance.delionLoopFuse && loopcounter>iotaInstance.delionBreakLoopCounter)throw new Error('Loop probs?')
		let taskResult = await delionCheckResult(
			jobId,
			iotaInstance.delionUrl,
			iotaInstance.delionToken				
		)
		switch (taskResult.status) {
			case 202:
				//wating for pow
				loopcounter--
				await waitFor(iotaInstance.delionGetPowDelay)
				return await jobCompletionChecker()
				break;
			case 200:
				//pow is ready. get trytes
				let data= await taskResult.json()
				return data.trytes
				break;
			case 401: case 403:
				// not authorized or token expired
				let tokenId = await delionAuth(
					iotaInstance
				)
				//set or update global token
				iotaInstance.delionToken=tokenId
				await waitFor(200)
				return await jobCompletionChecker()
				break;
			case 429: 
				//too busy
				await waitFor(2000)
				return await jobCompletionChecker()
				break;
			default:
				// errors 400,500,502
				throw new Error(taskResult.status+":"+taskResult.statusText)
				break;
		}
	}

	//await waitFor(2000)
	let responseTrytes= await jobCompletionChecker()
	return responseTrytes
}



// Get tokenId
const delionAuth = async (iotaInstance) => {
	let params = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    }
	const response = await fetch(iotaInstance.authorizationUrl+'?username='+iotaInstance.delionUsername+'&password='+iotaInstance.delionPassword,params)
    const data = await response.json()
    return data.tokenId
}

// Check the progress of the PoW
const delionCheckResult = async (jobId, delionUrl,tokenId) => {
	//console.log("Try to get JOB Result:",jobId)
	let params = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }
	params.headers['Authorization'] = tokenId	
	const response = await fetch(delionUrl+jobId, params)
    return response
}

const validate = (iotaInstance, trunk, branch, mwm, trytes, callback) => {
	
    // inputValidator: Check if correct hash
    if (!iotaInstance.valid.isHash(trunk))
        throw  new Error('You have provided an invalid hash as a trunk: ' + trunk)

    // inputValidator: Check if correct hash
    if (!iotaInstance.valid.isHash(branch))
        throw  new Error('You have provided an invalid hash as a branch: ' + branch)
	
	//check minWeightMagnitude
	if (!Number.isInteger(mwm) || mwm <= 0){
        throw new Error('minWeightMagnitude is not an integer or <=0')
    }

	//check trytes
	for (var tr of trytes) {
		if (!iotaInstance.valid.isTrytes(tr)) {
			throw new Error('Invalid Trytes provided')
		}
	}
}

module.exports = delionPatchIOTA
