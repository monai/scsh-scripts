/**
 *  ---------
 * |.##> <##.|  Open Smart Card Development Platform (www.openscdp.org)
 * |#       #|  
 * |#       #|  Copyright (c) 1999-2009 CardContact Software & System Consulting
 * |'##> <##'|  Andreas Schwier, 32429 Minden, Germany (www.cardcontact.de)
 *  --------- 
 *
 *  This file is part of OpenSCDP.
 *
 *  OpenSCDP is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License version 2 as
 *  published by the Free Software Foundation.
 *
 *  OpenSCDP is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with OpenSCDP; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * @fileoverview The class EMV contains necessary functions for transaction process.
 */

/**
 * EMV class constructor
 * @class This class implements functions for tansaction process 
 * @constructor
 * @param {object} card the card object 
 * @param {object} crypto the crypto object
 */
function EMV(card, crypto) {
	this.card = card;
	this.crypto = crypto;
	this.cardDE = new Array();
	this.terminalDE = new Array();
	
	this.terminalDE[EMV.UN] = crypto.generateRandom(4);
	
	this.terminalDE[0x9F33] = new ByteString("2028C0", HEX);
	this.terminalDE[0x9F1A] = new ByteString("0276", HEX);
	this.terminalDE[0x9F35] = new ByteString("15", HEX);
	this.terminalDE[0x9F40] = new ByteString("0200000000", HEX);
}

/**
 * Return cardDE
 *
 * @return the cardDE array 
 * @type Array
 */
EMV.prototype.getCardDataElements = function() {
	return this.cardDE;
}

/**
 * Send SELECT APDU
 *
 * @param {object} dfname the PSE AID
 * @param {boolean} first the selection options
 * @return the FCI
 * @type ByteString
 */
EMV.prototype.select = function(dfname, first) {
	var fci = this.card.sendApdu(0x00, 0xA4, 0x04, (first ? 0x00 : 0x02), dfname, 0x00);
	return(fci);
}

/**
 * Send READ RECORD APDU
 *
 * @param {number} sfi the Short File Identifier
 * @param {number} recno the record number
 * @return the corresponding record or empty ByteString if no data was read
 * @type ByteString
 */
EMV.prototype.readRecord = function(sfi, recno) {
	var data = this.card.sendApdu(0x00, 0xB2, recno, (sfi << 3) | 0x04, 0);
	if (this.card.SW1 == 0x6C) {
		var data = this.card.sendApdu(0x00, 0xB2, recno, (sfi << 3) | 0x04, this.card.SW2);
	}
	
	return(data);
}

/**
 * Create a Data Object List related ByteString
 * @param {object} dol the Data Object List
 * @return ByteString related to the DOL
 * @type ByteString
 */
EMV.prototype.createDOL = function(dol) {
print("Decoding DOL");
print("DOL: " + dol);
	var dolenc = new ByteBuffer();
	while(dol.length > 0) {
		var b = dol.byteAt(0);
		if((b&0x1F)==0x1F) {
			var tag = dol.left(2).toUnsigned();
			var length = dol.byteAt(2);
			var	dol = dol.bytes(3);	//Remove Tag and Length Byte
		}
		else {
			var tag = dol.left(1).toUnsigned();
			var length = dol.byteAt(1);
			var dol = dol.bytes(2);   //Remove Tag and Length Byte 
		}
		print("Tag: " + tag.toString(HEX));
		var addDolenc = this.terminalDE[tag];
		if (typeof(addDolenc) != "undefined") {
			// ToDo: Padding
			assert(length == addDolenc.length);
			dolenc.append(addDolenc);
		}
	}
	dolenc = dolenc.toByteString();
	//print("Return this dolenc: " + dolenc);
	
	return(dolenc);
}

/**
 * Send GET PROCESSING OPTION APDU
 *
 * @param{object} pdol the Processing Data Object List
 * @return the Application Interchange Profile and the Application File Locator
 * @type ByteString
 */
EMV.prototype.getProcessingOptions = function(pdol) {
	if (pdol == null) {
		var pdol = new ByteString("8300", HEX);							// OTHER
		//var pdol = new ByteString("830B0000000000000000000000", HEX);	// VISA
		//var pdol = new ByteString("830B2028C00276160200000000", HEX);	// VISA mit generate ac support
		//var pdol = new ByteString("830B2028C00276150200000000", HEX);	
	}
	var data = this.card.sendApdu(0x80, 0xA8, 0x00, 0x00, pdol, 0);
	
	return(data);
}

/**
 * Select and read Payment System Environment on either
 * contact or contactless card
 *
 * @param {boolean} contactless the PSE AID
 */
EMV.prototype.selectPSE = function(contactless) {
	print("<--Select and read Payment System Environment on either contact or contactless card---");
	this.PSE = null;
	var dfname = (contactless ? EMV.PSE2 : EMV.PSE1);
	var fci = this.select(dfname, true);
	print(fci);
	print("------------------------------------------------------------------------------>\n");
	

	if (fci.length == 0) {
		GPSystem.trace("No " + dfname.toString(ASCII) + " found");
		return;
	}
	
	// Decode FCI Template
	var tl = new TLVList(fci, TLV.EMV);
	var t = tl.index(0);
	assert(t.getTag() == EMV.FCI);
	var tl = new TLVList(t.getValue(), TLV.EMV);
	assert(tl.length >= 2);
	
	if(contactless) {
		// Decode FCI Proprietary Template
		t = tl.find(EMV.FCI_ISSUER);
		assert(t.getTag() == EMV.FCI_ISSUER);	

		var tl = new TLVList(t.getValue(), TLV.EMV);
		
		// Decode FCI Issuer Discretionary Data
		t = tl.index(0);
		assert(t.getTag() == EMV.FCI_ISSUER_DISCRETIONARY_DATA);
		
		tl = new TLVList(t.getValue(), TLV.EMV);
				
		this.PSE = new Array();
		
		for (var i = 0; i < tl.length; i++) {
			t = tl.index(i);
			assert(t.getTag() == EMV.DIRECTORY_ENTRY);
			this.PSE.push(new TLVList(t.getValue(), TLV.EMV));
		}while (data.length > 0);
	}
	else {
		
		// Decode DF Name
		t = tl.index(0);
		assert(t.getTag() == EMV.DFNAME);
		
		// Decode FCI Proprietary Template
		t = tl.index(1);
		assert(t.getTag() == EMV.FCI_ISSUER);
		
		var tl = new TLVList(t.getValue(), TLV.EMV);
		
		// Decode SFI of the Directory Elementary File
		t = tl.index(0);
		assert(t.getTag() == EMV.SFI);
		var sfi = t.getValue();
		assert(sfi.length == 1);
		sfi = sfi.byteAt(0);

		this.PSE = new Array();
		
		// Read all records from Directory Elementary File
		var recno = 1;
		do	{
			var data = this.readRecord(sfi, recno++);
			if (data.length > 0) {
				var tl = new TLVList(data, TLV.EMV);
				assert(tl.length == 1);
				var t = tl.index(0);
				assert(t.getTag() == EMV.TEMPLATE);
				var tl = new TLVList(t.getValue(), TLV.EMV);
				assert(tl.length >= 1);
				for (var i = 0; i < tl.length; i++) {
					var t = tl.index(i);
					assert(t.getTag() == 0x61);
					print(t.getValue());
					this.PSE.push(new TLVList(t.getValue(), TLV.EMV));
				}
			}
		} while (data.length > 0);
	}
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Return array of PSE entries or null if none defined
 * @return the PSE array
 * @type Array
 */
EMV.prototype.getPSE = function() {
	return this.PSE;
}

/**
 * Return AID of application with highest priority or null if no PSE defined
 * @return the AID
 * @type ByteString
 */
EMV.prototype.getAID = function() {
	print("<--Return AID of application with highest priority or null if no PSE defined---");
	var prio = 0xFFFF;
	var aid = null;
	var pse = e.getPSE();
	if (pse == null) {
		print("------------------------------------------------------------------------------>\n");
		return null;
	}
	// Iterate through PSE entries
	for (var i = 0; i < pse.length; i++) {
		var t = pse[i].find(EMV.AID);
		assert(t != null);
		var entryAid = t.getValue();
		print(entryAid);

		var t = pse[i].find(EMV.LABEL);
		assert(t != null);
		print(t.getValue().toString(ASCII));

		var entryPrio = 0xFFFE;
		var t = pse[i].find(EMV.PRIORITY);
		if (t != null) {
			entryPrio = t.getValue().toUnsigned();
			entryPrio &= 0x0F;
		}
		if (entryPrio < prio) {
			prio = entryPrio;
			aid = entryAid;
		}
	}
	this.cardDE[EMV.AID] = aid;
	return aid;
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Select application and return FCI
 * @param {object} aid the Application Identifier
 */
EMV.prototype.selectADF = function(aid) {
	print("<----------------------Select application and return FCI-----------------------");
	var fci = this.select(aid, true);
	print(fci);
	this.decodeFCI(fci);	
	this.cardDE[EMV.AID] = aid;
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Decode the A5 Template from the FCI
 * @param {object} fci the File Control Informations
 */
EMV.prototype.decodeFCI = function(fci) {
	print("<---------------------Decode the A5 Template from the FCI----------------------");
	var fcitlv = new ASN1(fci);
	var a5 = fcitlv.find(0xA5);
	
	if (a5 != null) {
		for (var i = 0; i < a5.elements; i++) {
			this.cardDE[a5.get(i).tag] = a5.get(i).value;
			print(a5.get(i).tag.toString(HEX));
		}
	}
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Try a list of predefined AID in order to select an application
 */
EMV.prototype.tryAID = function() {
	print("<--------Try a list of predefined AID in order to select an application--------");
	for (var i = 0; i < EMV.AIDLIST.length; i++) {
		var le = EMV.AIDLIST[i];
		var aid = new ByteString(le.aid, HEX);
		var fci = this.select(aid, true);	
		
		if (fci.length > 0) {
			this.cardDE[EMV.AID] = aid;
			print("FCI returned in SELECT: ", new ASN1(fci));
			this.decodeFCI(fci);
			print("------------------------------------------------------------------------------>\n");
			return;
		}		
	}	
}

/**
 * Add elements from ByteString into the cardDE array
 * @param {object} tlvlist
 */
EMV.prototype.addCardDEFromList = function(tlvlist) {
	print("<--Add elements from ByteString into the cardDE array---");
	for (var i = 0; i < tlvlist.length; i++) {
		var t = tlvlist.index(i);
		if(t.getTag() != 0){
		print(t.getTag().toString(16) + " - " + t.getValue());
		this.cardDE[t.getTag()] = t.getValue();
		}
	}
	print("------------------------------------------------------->\n");
}

/**
 * Inform the ICC that a new transaction is beginning.
 * Store AIP and AFL into the cardDE array.
 */
EMV.prototype.initApplProc = function() {
	print("<-------------Inform the ICC that a new transaction is beginning.--------------");
	var pdol = this.cardDE[EMV.PDOL];
	var pdolenc = null;
	if (typeof(pdol) != "undefined") {
		pdolenc = this.createDOL(pdol);
		var length = pdolenc.length
		var length = length.toString(HEX);
		if (pdolenc.length <= 0xF) {
			var zahlnull = "0";
			length = zahlnull.concat(length);
		}
		var length = new ByteString(length, HEX);	
		pdolenc = new ByteString("83", HEX).concat(length).concat(pdolenc);
		print(pdolenc);
	}
	
	var data = this.getProcessingOptions(pdolenc);
	print(data);
	var tl = new TLVList(data, TLV.EMV);
	assert(tl.length == 1);
	var t = tl.index(0);
	if (t.getTag() == EMV.RMTF1) {	// Format 1
		this.cardDE[EMV.AIP] = t.getValue().left(2);
		this.cardDE[EMV.AFL] = t.getValue().bytes(2);
	} else {
		assert(t.getTag() == EMV.RMTF2);
		tl = new TLVList(t.getValue(), TLV.EMV);
		assert(tl.length >= 2);
		this.addCardDEFromList(tl);
	}
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Read application data as indicated in the Application File Locator.
 * Collect input to data authentication.
 *
 */
EMV.prototype.readApplData = function() {
	print("<-----Read application data as indicated in the Application File Locator.------");
	print("---------------------Collect input to data authentication.---------------------");
	// Application File Locator must exist
	assert(typeof(this.cardDE[EMV.AFL]) != "undefined");
	var afl = this.cardDE[EMV.AFL];
	
	// Must be a multiple of 4
	assert((afl.length & 0x03) == 0);

	// Collect input to data authentication	
	var da = new ByteBuffer();
	
	while(afl.length > 0) {
		var sfi = afl.byteAt(0) >> 3;	// Short file identifier
		var srec = afl.byteAt(1);	// Start record
		var erec = afl.byteAt(2);	// End record
		var dar = afl.byteAt(3);	// Number of records included in data authentication
		
		for (; srec <= erec; srec++) {
			// Read all indicated records
			var data = this.readRecord(sfi, srec);
			print("Record No. " + srec);
			print(data);
			
			// Decode template
			var tl = new TLVList(data, TLV.EMV);
			assert(tl.length == 1);
			var t = tl.index(0);
			assert(t.getTag() == EMV.TEMPLATE);

			// Add data authentication input			
			if (dar > 0) {
				if (sfi <= 10) {	// Only value
					da.append(t.getValue());
				} else {		// Full template
					da.append(data);
				}
				dar--;
			}

			// Add card based data elements	to internal list
			var tl = new TLVList(t.getValue(), TLV.EMV);
			this.addCardDEFromList(tl);
		}

		// Continue with next entry in AFL
		afl = afl.bytes(4);
	}
	this.daInput = da.toByteString();
	print(this.daInput);
	print("------------------------------------------------------------------------------>\n");
}

/**
 * Return the Data Authentication Input
 * @return the Data Authentication Input
 * @type ByteString
 */
EMV.prototype.getDAInput = function() {
	return this.daInput;
}

/**
 * Send GENERATE APPLICATION CRYPTOGRAM APDU
 */
EMV.prototype.generateAC = function() {
/*
p1
0x00 = AAC = reject transaction
0x40 = TC = proceed offline
0x80 = ARQC = go online
*/

var p1 = 0x40;

var authorisedAmount = new ByteString("000000000001", HEX);
var secondaryAmount = new ByteString("000000000000", HEX);
var tvr = new ByteString("0000000000", HEX);
var transCurrencyCode = new ByteString("0978", HEX);
var transDate = new ByteString("090730", HEX);
var transType = new ByteString("21", HEX);
var unpredictableNumber = crypto.generateRandom(4);
var iccDynamicNumber = card.sendApdu(0x00, 0x84, 0x00, 0x00, 0x00);
var DataAuthCode = this.cardDE[0x9F45];

var Data = authorisedAmount.concat(secondaryAmount).concat(tvr).concat(transCurrencyCode).concat(transDate).concat(transType).concat(unpredictableNumber).concat(iccDynamicNumber).concat(DataAuthCode); 

var generateAC = card.sendApdu(0x80, 0xAE, p1, 0x00, Data, 0x00);
}

// Constants

EMV.PSE1 = new ByteString("1PAY.SYS.DDF01", ASCII);
EMV.PSE2 = new ByteString("2PAY.SYS.DDF01", ASCII);

EMV.AID = 0x4F;
EMV.LABEL = 0x50;
EMV.FCI = 0x6F;
EMV.TEMPLATE = 0x70;
EMV.RMTF2 = 0x77;
EMV.RMTF1 = 0x80;
EMV.AIP = 0x82;
EMV.DFNAME = 0x84;
EMV.PRIORITY = 0x87;
EMV.SFI = 0x88;
EMV.CDOL1 = 0x8C;
EMV.CDOL2 = 0x8D;
EMV.CAPKI = 0x8F;
EMV.AFL = 0x94;
EMV.FCI_ISSUER = 0xA5;
EMV.UN = 0x9F37;
EMV.PDOL = 0x9F38;
EMV.SDATL = 0x9F4A;
EMV.FCI_ISSUER_DISCRETIONARY_DATA = 0xBF0C;
EMV.DIRECTORY_ENTRY = 0x61;

EMV.AIDLIST = new Array();
EMV.AIDLIST[0] = { aid : "A00000002501", partial : true, name : "AMEX" };
EMV.AIDLIST[1] = { aid : "A0000000031010", partial : false, name : "VISA" };
EMV.AIDLIST[2] = { aid : "A0000000041010", partial : false, name : "MC" };

EMV.TAGLIST = new Array();
EMV.TAGLIST[EMV.UN] = { name : "Unpredictable Number" };
EMV.TAGLIST[EMV.CAPKI] = { name : "Certification Authority Public Key Index" };
EMV.TAGLIST[EMV.SDATL] = { name : "Static Data Authentication Tag List" };
EMV.TAGLIST[EMV.CDOL1] = { name : "Card Risk Management Data Object List 1" };
EMV.TAGLIST[EMV.CDOL2] = { name : "Card Risk Management Data Object List 2" };

//EMV.pdol = 0x9F38179F1A0200009F33030000009F3501009F40050000000000;