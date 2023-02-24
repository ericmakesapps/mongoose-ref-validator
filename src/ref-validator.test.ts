import mongoose, { Document, Model, Types, Schema } from "mongoose"
import validator, { getConstructor } from "./ref-validator"
import async from "async"
import should from "should"

import { MongoMemoryReplSet } from "mongodb-memory-server"

import uuid from "@ericbf/helpers/uuid"

let mongo: MongoMemoryReplSet

const RefValidator = getConstructor()

function validatorConcept(schema) {
	var refvalidator = new RefValidator()
	schema.plugin(RefValidator.prototype.validate.bind(refvalidator))

	schema.statics.enableValidation = function () {
		refvalidator.enable()
	}

	schema.statics.disableValidation = function () {
		refvalidator.disable()
	}
}

describe("Mongoose Ref Validator plugin", function () {
	// Use a single connection. Initializing the memory DB is the bottleneck.
	this.beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create()

		await mongoose.connect(mongo.getUri())
	})

	// For every test, just use a new DB, always unique by using uuid.
	let Manufacturer: Model<{ name?: string }>
	let Color: Model<{ name: string }>
	var colors: Record<string, Document<unknown, any, { name: string }>> = {}
	let Car: Model<{
		name?: string
		manufacturer?: Types.ObjectId | undefined
		colors: Types.ObjectId[]
	}>
	let Bike: Model<{
		name?: string
		manufacturer?: Types.ObjectId | undefined
		colors: Types.ObjectId[]
	}>

	this.beforeEach(async () => {
		const id = uuid()

		await mongoose.connection.useDb(id)

		var ManufacturerSchema = new Schema({
			name: String
		})
		Manufacturer = mongoose.model("Manufacturer" + id, ManufacturerSchema)
		var ColorSchema = new Schema({
			name: { type: String, required: true }
		})
		Color = mongoose.model("Color" + id, ColorSchema)

		await Promise.all(
			["red", "green", "black", "blue", "silver"].map(async (name) => {
				colors[name] = await Color.create({
					name
				})
			})
		)

		var CarSchema = new Schema({
			name: String,
			manufacturer: {
				type: Schema.Types.ObjectId,
				ref: "Manufacturer" + id
			},
			colors: [
				{
					type: Schema.Types.ObjectId,
					ref: "Color" + id
				}
			]
		})
		CarSchema.plugin(validator, {
			message: "{PATH} ID is bad"
		})
		Car = mongoose.model("Car" + id, CarSchema)

		var BikeSchema = new Schema({
			name: String,
			manufacturer: {
				type: Schema.Types.ObjectId,
				ref: "Manufacturer" + id
			},
			colors: [
				{
					type: Schema.Types.ObjectId,
					ref: "Color" + id
				}
			]
		})

		validatorConcept(BikeSchema)

		Bike = mongoose.model("Bike" + id, BikeSchema)
	})

	it(
		"Should allow no manufacturer/color IDs as developer can use " +
			"mongoose required option to make these mandatory",
		async () => {
			await Car.create({
				name: "Test Car"
			})
		}
	)

	it("Should pass validation with explicit null ID", function (done) {
		var c = new Car({
			name: "Test Car",
			manufacturer: null
		})
		c.validate(done)
	})

	it("Should pass validation with explicit undefined ID", function (done) {
		var c = new Car({
			name: "Test Car",
			manufacturer: undefined
		})
		c.validate(done)
	})

	it("Should pass validation with explicit null array", function (done) {
		var c = new Car({
			name: "Test Car",
			colors: null
		})
		c.save(done)
	})

	it("Should pass validation with explicit undefined array", function (done) {
		var c = new Car({
			name: "Test Car",
			colors: undefined
		})
		c.save(done)
	})

	it("Should pass validation with existing ID", function (done) {
		var m = new Manufacturer({
			name: "Car Maker"
		})
		var c = new Car({
			name: "Test Car",
			manufacturer: m
		})
		async.series([m.save.bind(m), c.save.bind(c)], done)
	})

	it("Should fail validation with custom message on bad ID", function (done) {
		var c = new Car({
			name: "Test Car",
			manufacturer: "50136e40c78c4b9403000001"
		})
		c.validate(function (err) {
			err.name.should.eql("ValidationError")
			err.errors.manufacturer.message.should.eql("manufacturer ID is bad")
			done()
		})
	})

	it("Should fail validation on bad ID with IdValidator instance", function (done) {
		var b = new Bike({
			name: "Test Bike",
			manufacturer: "50136e40c78c4b9403000001"
		})
		b.validate(function (err) {
			err.name.should.eql("ValidationError")
			err.errors.manufacturer.message.should.eql(
				"manufacturer references a non existing document"
			)
			done()
		})
	})

	it("Should ignore validation when it is disabled", function (done) {
		Bike.disableValidation()
		var b = new Bike({
			name: "Test Bike",
			manufacturer: "50136e40c78c4b9403000001"
		})
		b.save(done)
	})

	it("Should fail validation if bad ID set after previously good ID value", function (done) {
		var savePassed = false
		var m = new Manufacturer({
			name: "Car Maker"
		})
		var c = new Car({
			name: "Test Car",
			manufacturer: m
		})
		async.series(
			[
				m.save.bind(m),
				c.save.bind(c),
				function (cb) {
					savePassed = true
					c.manufacturer = new Types.ObjectId("50136e40c78c4b9403000001")
					c.save(cb)
				}
			],
			function (err) {
				should(savePassed).be.ok
				err.name.should.eql("ValidationError")
				err.errors.manufacturer.message.should.eql("manufacturer ID is bad")
				done()
			}
		)
	})

	it("Should pass validation if no ID value changed (even when manufacturer subsequently removed)", function (done) {
		var m = new Manufacturer({
			name: "Car Maker"
		})
		var c = new Car({
			name: "Test Car",
			manufacturer: m
		})
		async.series(
			[
				m.save.bind(m),
				c.save.bind(c),
				Manufacturer.deleteMany.bind(Manufacturer, {}),
				c.save.bind(c)
			],
			done
		)
	})

	it("Should validate correctly IDs in an array of ID references", function (done) {
		var c = new Car({
			name: "Test Car",
			colors: [colors["red"]._id, colors["blue"]._id, colors["black"]._id]
		})
		c.save(done)
	})

	it("Should fail ID validation in an array of ID references", function (done) {
		var c = new Car({
			name: "Test Car",
			colors: [colors["red"], "50136e40c78c4b9403000001", colors["black"]]
		})
		c.save(function (err) {
			err.name.should.eql("ValidationError")
			err.errors.colors.message.should.eql("colors ID is bad")
			done()
		})
	})

	it("Array of ID values should pass validation if not modified since last save", function (done) {
		var car = new Car({
			type: Schema.Types.ObjectId,
			colors: [colors["red"], colors["blue"], colors["black"]]
		})
		async.series(
			[
				car.save.bind(car),
				function (cb) {
					colors["blue"].remove(cb)
				},
				car.validate.bind(car)
			],
			done
		)
	})

	it("Should not trigger ref validation if path not modified", function (done) {
		var m = new Manufacturer({})
		var c = new Car({
			manufacturer: m._id,
			name: "c"
		})
		var called = 0
		var tmp = Manufacturer.countDocuments
		Manufacturer.countDocuments = function () {
			called++
			return tmp.apply(this, arguments)
		}
		async.waterfall(
			[
				function (cb) {
					m.save(cb)
				},
				function (_, cb) {
					c.save(cb)
				},
				function (_, cb) {
					Car.findById(c._id, cb)
				},
				function (c, cb) {
					c.name = "d"
					c.validate(cb) //must not trigger a count as manufacturerId not modified
				},
				function (cb) {
					should(called).be.equal(1)
					cb(null)
				}
			],
			function (err) {
				Manufacturer.countDocuments = tmp
				done(err)
			}
		)
	})

	describe("refConditions tests", async function () {
		let id = uuid()

		var PersonSchema = new Schema({
			name: String,
			gender: {
				type: String,
				enum: ["m", "f"]
			}
		})
		var Person = mongoose.model("Person" + id, PersonSchema)

		var InfoSchema = new Schema({
			bestMaleFriend: {
				type: Schema.Types.ObjectId,
				ref: "Person" + id,
				refConditions: {
					gender: "m"
				}
			},
			femaleFriends: [
				{
					type: Schema.Types.ObjectId,
					ref: "Person" + id,
					refConditions: {
						gender: "f"
					}
				}
			]
		})
		InfoSchema.plugin(validator)
		var Info = mongoose.model("Info" + id, InfoSchema)

		type Person = mongoose.Document<
			unknown,
			any,
			{
				name?: string | undefined
				gender?: "m" | "f" | undefined
			}
		> &
			Omit<
				{
					name?: string | undefined
					gender?: "m" | "f" | undefined
				} & {
					_id: Types.ObjectId
				},
				never
			>

		let jack: Person
		let jill: Person
		let ann: Person

		this.beforeEach(async () => {
			jack = await Person.create({ name: "Jack", gender: "m" })
			jill = await Person.create({ name: "Jill", gender: "f" })
			ann = await Person.create({ name: "Ann", gender: "f" })
		})

		it("Should validate with single ID value that matches condition", function (done) {
			var i = new Info({ bestMaleFriend: jack })
			i.validate(done)
		})

		it("Should fail to validate single ID value that exists but does not match conditions", function (done) {
			var i = new Info({ bestMaleFriend: jill })
			i.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("bestMaleFriend")
				done()
			})
		})

		it("Should validate array of ID values that match conditions", function (done) {
			var i = new Info({ femaleFriends: [ann._id, jill._id] })
			i.validate(done)
		})

		it("Should not validate array of ID values containing value that exists but does not match conditions", function (done) {
			var i = new Info({ femaleFriends: [jill, jack] })
			i.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("femaleFriends")
				done()
			})
		})
	})

	describe("refConditions with function tests", async function () {
		let id = uuid()

		var PeopleSchema = new Schema({
			name: String,
			gender: {
				type: String,
				enum: ["m", "f"]
			}
		})
		var People = mongoose.model("People" + id, PeopleSchema)

		var FriendSchema = new Schema({
			mustBeFemale: Boolean,
			bestFriend: {
				type: Schema.Types.ObjectId,
				ref: "People" + id,
				refConditions: {
					gender: function () {
						return this.mustBeFemale ? "f" : "m"
					}
				}
			},
			friends: [
				{
					type: Schema.Types.ObjectId,
					ref: "People" + id,
					refConditions: {
						gender: function () {
							return this.mustBeFemale ? "f" : "m"
						}
					}
				}
			]
		})
		FriendSchema.plugin(validator)

		var Friends = mongoose.model("Friends" + id, FriendSchema)

		type People = mongoose.Document<
			unknown,
			any,
			{
				name?: string | undefined
				gender?: "m" | "f" | undefined
			}
		> &
			Omit<
				{
					name?: string | undefined
					gender?: "m" | "f" | undefined
				} & {
					_id: Types.ObjectId
				},
				never
			>

		let jack: People
		let jill: People
		let ann: People

		this.beforeEach(async () => {
			jack = await People.create({ name: "Jack", gender: "m" })
			jill = await People.create({ name: "Jill", gender: "f" })
			ann = await People.create({ name: "Ann", gender: "f" })
		})

		it("Should validate with single ID value that matches condition", function (done) {
			var i = new Friends({ mustBeFemale: false, bestFriend: jack._id })
			i.validate(done)
		})

		it("Should fail to validate single ID value that exists but does not match conditions", function (done) {
			var i = new Friends({ mustBeFemale: true, bestFriend: jack._id })
			i.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("bestFriend")
				done()
			})
		})

		it("Should validate array of ID values that match conditions", function (done) {
			var i = new Friends({ mustBeFemale: true, friends: [ann, jill] })
			i.validate(done)
		})

		it("Should not validate array of ID values containing value that exists but does not match conditions", function (done) {
			var i = new Friends({
				mustBeFemale: true,
				friends: [jill._id, jack._id]
			})

			i.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("friends")

				done()
			})
		})
	})

	describe("Array Duplicate Tests", async () => {
		let id = uuid()

		var InventoryItemSchema = new Schema({
			name: String
		})

		function createInventorySchema(options?: { allowDuplicates: boolean }) {
			var s = new Schema({
				items: [
					{
						type: Schema.Types.ObjectId,
						ref: "InventoryItem" + id
					}
				]
			})
			s.plugin(validator, options)
			return s
		}

		var InventoryNoDuplicatesSchema = createInventorySchema()
		var InventoryDuplicatesSchema = createInventorySchema({
			allowDuplicates: true
		})

		var InventoryItem = mongoose.model("InventoryItem" + id, InventoryItemSchema)
		var InventoryNoDuplicates = mongoose.model(
			"InventoryNoDuplicates" + id,
			InventoryNoDuplicatesSchema
		)
		var InventoryDuplicates = mongoose.model(
			"InventoryDuplicatesSchema" + id,
			InventoryDuplicatesSchema
		)

		var item1: mongoose.Document<
			unknown,
			any,
			{
				name?: string | undefined
			}
		> &
			Omit<
				{
					name?: string | undefined
				} & {
					_id: Types.ObjectId
				},
				never
			>

		this.beforeEach(async () => {
			item1 = await InventoryItem.create({ name: "Widgets" })
		})

		it("Should fail to validate duplicate entries with default option", function (done) {
			var i = new InventoryNoDuplicates({ items: [item1._id, item1._id] })
			i.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("items")
				done()
			})
		})

		it("Should pass validation of duplicate entries when allowDuplicates set", async () => {
			await InventoryDuplicates.create({ items: [item1._id, item1._id] })
		})
	})

	describe("Recursion Tests", function () {
		let id = uuid()
		var contactSchema = new mongoose.Schema({})
		var listSchema = new mongoose.Schema({
			name: String,
			contacts: [
				{
					reason: String,
					contactId: {
						type: Schema.Types.ObjectId,
						ref: "Contact" + id
					}
				}
			]
		})
		listSchema.plugin(validator)

		var Contact = mongoose.model("Contact" + id, contactSchema)
		var List = mongoose.model("List" + id, listSchema)

		it("Should allow empty array", function (done) {
			var obj = new List({ name: "Test", contacts: [] })
			obj.validate(done)
		})

		it("Should fail on invalid ID inside sub-schema", function (done) {
			var obj = new List({
				name: "Test",
				contacts: [{ reason: "My friend", contactId: "50136e40c78c4b9403000001" }]
			})
			obj.validate(function (err) {
				err.should.property("name", "ValidationError")
				err.errors.should.property("contacts.0.contactId")
				done()
			})
		})

		it("Should pass on valid ID in sub-schema", function (done) {
			var c = new Contact({})
			async.series(
				[
					function (cb) {
						c.save(cb)
					},
					function (cb) {
						var obj = new List({
							name: "Test",
							contacts: [{ reason: "My friend", contactId: c }]
						})
						obj.validate(cb)
					}
				],
				done
			)
		})
	})

	describe("Self recursive schema", function () {
		let id = uuid()
		var Tasks = new mongoose.Schema()
		Tasks.add({
			title: String,
			subtasks: [Tasks]
		})
		Tasks.plugin(validator)
		var Task = mongoose.model("Tasks" + id, Tasks)

		it("Should validate recursive task", function (done) {
			var t1 = new Task({ title: "Task 1" })
			var t2 = new Task({ title: "Task 2", subtasks: [t1] })
			async.series(
				[
					function (cb) {
						t1.save(cb)
					},
					function (cb) {
						t2.save(cb)
					}
				],
				done
			)
		})
	})

	describe("Connection tests", function () {
		it("Correct connection should be used when specified as option", async function () {
			let connection2 = mongoose.createConnection()

			await connection2.openUri(mongo.getUri("connection-tests"))

			var UserSchema = new Schema({
				name: String
			})
			var User1 = mongoose.model("User", UserSchema)
			var User2 = connection2.model("User", UserSchema)

			var ItemSchema1 = new Schema({
				owner: {
					type: Schema.Types.ObjectId,
					ref: "User"
				}
			})
			ItemSchema1.plugin(validator)
			var ItemSchema2 = new Schema({
				owner: {
					type: Schema.Types.ObjectId,
					ref: "User"
				}
			})
			ItemSchema2.plugin(validator, {
				connection: connection2
			})
			var Item1 = mongoose.model("Item", ItemSchema1)
			var Item2 = connection2.model("Item", ItemSchema2)

			await User1.create({ _id: "50136e40c78c4b9403000001" })
			await User2.create({ _id: "50136e40c78c4b9403000002" })
			await Item1.create({ owner: "50136e40c78c4b9403000001" })
			await Item2.create({ owner: "50136e40c78c4b9403000002" })

			var bad1 = new Item1({ owner: "50136e40c78c4b9403000002" })
			var bad2 = new Item2({ owner: "50136e40c78c4b9403000001" })

			return new Promise((done) =>
				async.series([
					function (cb) {
						bad1.validate(function (err) {
							should(!!err).eql(true)
							err.should.property("name", "ValidationError")
							err.errors.should.property("owner")
							cb()
						})
					},
					function (cb) {
						bad2.validate(function (err) {
							should(!!err).eql(true)
							err.should.property("name", "ValidationError")
							err.errors.should.property("owner")
							cb()
						})
					},
					connection2.close.bind(connection2),
					done
				])
			)
		})
	})

	// After every test, drop the DB that was used—clean-up.
	this.afterEach(async () => {
		await mongoose.connection.dropDatabase()
	})

	// After all tests are done, clean-up the connection.
	this.afterAll(async () => {
		await mongoose.connection.close()
		await mongo?.stop()
	})
})
