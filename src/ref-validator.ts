import mongoose, {
	Connection,
	Document,
	Model,
	Query,
	Schema,
	SchemaType,
	Types
} from "mongoose"
import traverse from "traverse"
import clone from "clone"

interface MongooseRefValidatorOptions {
	/* Optional, custom validation message with {PATH} being replaced
	 * with the relevant schema path that contains an invalid
	 * document ID.
	 */
	message?: string | undefined

	/* Optional, mongoose connection object to use if you are
	 * using multiple connections in your application.
	 *
	 * Defaults to built-in mongoose connection if not specified.
	 */
	connection?: Connection | undefined

	/* Optional, applies to validation of arrays of ID references only. Set
	 * to true if you sometimes have the same object ID reference
	 * repeated in an array. If set, the validator will use the
	 * total of unique ID references instead of total number of array
	 * entries when checking the database.
	 *
	 * Defaults to false
	 */
	allowDuplicates?: boolean | undefined
}

class RefValidator {
	private enabled = true

	enable() {
		this.enabled = true
	}

	disable() {
		this.enabled = false
	}

	validate(schema: Schema, options: MongooseRefValidatorOptions) {
		let self = this
		options = options || {}
		let message = options.message || "{PATH} references a non existing document"
		let connection = options.connection || mongoose.connection
		let allowDuplicates = options.allowDuplicates || false

		let caller = self instanceof RefValidator ? self : RefValidator.prototype

		return caller.validateSchema(schema, message, connection, allowDuplicates)
	}

	validateSchema(
		schema: Schema,
		message: string,
		connection: Connection,
		allowDuplicates?: boolean
	) {
		let self = this
		let caller = self instanceof RefValidator ? self : RefValidator.prototype

		schema.eachPath((path, schemaType) => {
			// Apply validation recursively to sub-schemas (but not ourself if we
			// are referenced recursively)
			if (schemaType.schema && schemaType.schema !== schema) {
				return caller.validateSchema(schemaType.schema, message, connection)
			}

			let validateFunction: typeof validateRef | typeof validateRefArray
			let refModelName: string | undefined
			let refModelPath: string | ((this: Document) => string) | undefined
			let conditions = {}
			let refKey = schemaType.options?.foreignField ?? "_id"

			if (schemaType.options && schemaType.options.ref) {
				refModelName = schemaType.options.ref
				if (schemaType.options.refConditions) {
					conditions = schemaType.options.refConditions
				}
			} else if (schemaType.options && schemaType.options.refPath) {
				refModelPath = schemaType.options.refPath ?? schemaType.options.refFn

				if (schemaType.options.refConditions) {
					conditions = schemaType.options.refConditions
				}
			} else if (
				"caster" in schemaType &&
				schemaType.caster instanceof SchemaType &&
				schemaType.caster.instance &&
				schemaType.caster.options &&
				schemaType.caster.options.ref
			) {
				refModelName = schemaType.caster.options.ref
				if (schemaType.caster.options.refConditions) {
					conditions = schemaType.caster.options.refConditions
				}
			}

			let isArraySchemaType =
				("caster" in schemaType &&
					schemaType.caster instanceof SchemaType &&
					schemaType.caster.instance) ||
				schemaType.instance === "Array" ||
				(schemaType as any)["$isMongooseArray"] === true
			validateFunction = isArraySchemaType ? validateRefArray : validateRef

			if (refModelName || refModelPath) {
				schema.path(path).validate({
					// @ts-expect-error the type thinks this should be different
					validator: function (this: Model, value: any): Promise<boolean> {
						return new Promise((resolve, reject) => {
							let conditionsCopy = conditions
							//A query may not implement an isModified function.
							if (this && !!this.isModified && !this.isModified(path)) {
								resolve(true)
								return
							}
							if (!(self instanceof RefValidator) || self.enabled) {
								if (Object.keys(conditionsCopy).length > 0) {
									let instance = this

									conditionsCopy = clone(conditions)
									traverse(conditionsCopy).forEach(function (value) {
										if (typeof value === "function") {
											this.update(value.call(instance))
										}
									})
								}

								return validateFunction(
									this,
									connection,
									refModelName ?? this[refModelPath],
									refKey,
									value,
									conditionsCopy,
									resolve,
									reject,
									allowDuplicates
								)
							}
							resolve(true)
							return
						})
					},
					message: message
				})
			}
		})
	}
}

function executeQuery(
	query: Query<number, Document>,
	conditions: Record<string, any>,
	validateValue: number,
	resolve: (valid: boolean) => void,
	reject: (error: any) => void
) {
	for (let fieldName in conditions) {
		query.where(fieldName, conditions[fieldName])
	}

	query.exec((err, count) => {
		if (err) {
			reject(err)

			return
		}

		return count === validateValue ? resolve(true) : resolve(false)
	})
}

function validateRef(
	doc: mongoose.Document,
	connection: mongoose.Connection,
	refModelName: string | ((this: Document) => string),
	refKey: string,
	value: any,
	conditions: any,
	resolve: (valid: boolean) => void,
	reject: (error: any) => void
) {
	if (value == null) {
		resolve(true)
		return
	}
	let refModel = connection.model(
		typeof refModelName === "string" ? refModelName : refModelName.call(doc)
	)
	let query = refModel.countDocuments({ [refKey]: value })
	let session = doc.$session && doc.$session()
	if (session) {
		query.session(session)
	}
	executeQuery(query, conditions, 1, resolve, reject)
}

function validateRefArray(
	doc: mongoose.Document,
	connection: mongoose.Connection,
	refModelName: string | ((this: Document) => string),
	refKey: string,
	values: Types.ObjectId[],
	conditions: any,
	resolve: (valid: boolean) => void,
	reject: (error: any) => void,
	allowDuplicates = false
) {
	if (values == null || values.length == 0) {
		resolve(true)
		return
	}

	let checkValues = allowDuplicates
		? values.filter((v, i) => values.findIndex(({ _id }) => _id === v._id) === i)
		: values

	let refModel = connection.model(
		typeof refModelName === "string" ? refModelName : refModelName.call(doc)
	)
	let query = refModel.countDocuments().where(refKey).in(checkValues)
	let session = doc.$session && doc.$session()
	if (session) {
		query.session(session)
	}

	executeQuery(query, conditions, checkValues.length, resolve, reject)
}

export default RefValidator.prototype.validate

export function getConstructor() {
	return RefValidator
}
