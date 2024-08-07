import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { MessagesHelper } from 'src/helpers/messages.helper';
import { getFilters } from 'src/util/getFilters';
import { getResidueTitle } from 'src/util/getResidueTitle';

import { DocumentsService, ResidueType } from '@/documents';
import { ProfileType } from '@/graphql/entities/user.entity';
import { ListFiltersInput } from '@/graphql/inputs/list-filters-input';
import { S3Service } from '@/s3/s3.service';
import { UsersService } from '@/users/users.service';

import { CreateFormDto, FindFormDto } from './dtos';

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly s3Service: S3Service,
    private readonly usersService: UsersService,
    private readonly documentsService: DocumentsService,
  ) {}

  async findByFormId(id: string) {
    const form = await this.prismaService.form.findUnique({
      where: {
        id,
      },
    });

    if (!form) throw new NotFoundException(MessagesHelper.FORM_NOT_FOUND);

    return form;
  }

  /**
   * @deprecated
   */
  listAllForms(filters?: ListFiltersInput) {
    let filterOptions = [];

    if (filters) {
      filterOptions = getFilters(filters);
    }

    return this.prismaService.form.findMany({
      where: {
        AND: filterOptions,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async findAllNew(args: FindFormDto) {
    const { page, limit, orderBy, sortBy, includeDocuments, ...filters } = args;

    const forms = await this.prismaService.form.findMany({
      where: filters,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: {
        [sortBy]: orderBy,
      },
      include: {
        document: includeDocuments ? true : false,
      },
    });

    const total = await this.prismaService.form.count({
      where: filters,
    });

    return {
      data: forms,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async aggregateFormByUserProfile() {
    const [allFormsByRecyclers, allFormsByWasteGenerators] = await Promise.all([
      this.prismaService.form.findMany({
        where: {
          user: {
            is: {
              profileType: 'RECYCLER',
            },
          },
        },
      }),
      this.prismaService.form.findMany({
        where: {
          user: {
            is: {
              profileType: 'WASTE_GENERATOR',
            },
          },
        },
      }),
    ]);

    const [aggregateRecyclerData, aggregateWasteGenData] = await Promise.all([
      this.prismaService.document.groupBy({
        by: ['residueType'],
        _sum: {
          amount: true,
        },
        where: {
          OR: allFormsByRecyclers.map((form) => ({
            formId: form.id,
          })),
        },
      }),
      this.prismaService.document.groupBy({
        by: ['residueType'],
        _sum: {
          amount: true,
        },
        where: {
          OR: allFormsByWasteGenerators.map((form) => ({
            formId: form.id,
          })),
        },
      }),
    ]);

    const recyclerData = aggregateRecyclerData.map((data) => {
      return {
        amount: data._sum.amount,
        residueType: data.residueType,
      };
    });

    const wasteGeneratorData = aggregateWasteGenData.map((data) => {
      return {
        amount: data._sum.amount,
        residueType: data.residueType,
      };
    });

    const totalData = recyclerData.map((data) => {
      const currentWaste = wasteGeneratorData.find(
        (waste) => waste.residueType === data.residueType,
      );
      return {
        amount:
          Number(data.amount) + Number(currentWaste ? currentWaste.amount : 0),
        residueType: data.residueType,
      };
    });

    return [
      {
        id: 'RECYCLER',
        data: recyclerData,
      },
      {
        id: 'WASTE_GENERATOR',
        data: wasteGeneratorData,
      },
      {
        id: 'TOTAL',
        data: totalData,
      },
    ];
  }

  async createForm({
    authUserId,
    walletAddress,
    ...restFormData
  }: CreateFormDto) {
    const user = await this.usersService.findUserByAuthUserId(authUserId);

    const hasUploadedVideoOrInvoice = Object.entries(restFormData).some(
      ([, residueProps]) =>
        residueProps?.videoFileName || residueProps.invoicesFileName.length,
    );

    // Only RECYCLER and WASTE_GENERATOR can upload videos and invoices
    if (
      user.profileType !== ProfileType.RECYCLER &&
      user.profileType !== ProfileType.WASTE_GENERATOR &&
      hasUploadedVideoOrInvoice
    ) {
      throw new ForbiddenException(
        MessagesHelper.USER_DOES_NOT_HAS_PERMISSION_TO_UPLOAD,
      );
    }

    let responseData = [];

    const form = await this.prismaService.form.create({
      data: {
        userId: user.id,
        walletAddress,
      },
    });

    if (hasUploadedVideoOrInvoice) {
      const s3Data = await Object.entries(restFormData).reduce(
        async (asyncAllObjects, [residueType, residueProps]) => {
          const allDocuments = await asyncAllObjects;

          const documentEntity = {
            formId: form.id,
            residueType: residueType as ResidueType,
            invoicesFileName: [],
            amount: residueProps.amount,
            videoFileName: null,
          };

          let s3CreateVideoFileName = '';
          const s3CreateInvoiceFileName: string[] = [];

          if (residueProps.videoFileName) {
            const { fileName: s3FileName, createUrl } =
              await this.s3Service.createPreSignedObjectUrl(
                residueProps.videoFileName,
                residueType,
              );

            s3CreateVideoFileName = createUrl;
            documentEntity.videoFileName = s3FileName;
          }

          if (residueProps.invoicesFileName.length) {
            const invoicesS3Response = await Promise.all(
              residueProps.invoicesFileName.map((invoiceFile) => {
                return this.s3Service.createPreSignedObjectUrl(
                  invoiceFile,
                  residueType,
                );
              }),
            );
            invoicesS3Response.forEach(({ createUrl, fileName }) => {
              s3CreateInvoiceFileName.push(createUrl);
              documentEntity.invoicesFileName.push(fileName);
            });
          }

          const residueDocument = await this.prismaService.document.create({
            data: {
              ...documentEntity,
            },
          });

          return [
            ...allDocuments,
            {
              invoicesCreateUrl: s3CreateInvoiceFileName,
              invoicesFileName: residueDocument.invoicesFileName,
              videoCreateUrl: s3CreateVideoFileName,
              videoFileName: residueDocument.videoFileName,
              residue: residueType,
            },
          ];
        },
        Promise.resolve([]),
      );

      responseData = s3Data;
    }

    return {
      form,
      s3: responseData,
    };
  }

  async listAllFromUserByUserId(userId: string, filters?: ListFiltersInput) {
    let filterOptions = [];

    if (filters) {
      filterOptions = getFilters(filters);
    }

    return this.prismaService.form.findMany({
      where: {
        userId,
        AND: filterOptions,
      },
    });
  }

  async authorizeForm(formId: string, isFormAuthorized: boolean) {
    // TO DO: Check if form was created by a RECYCLER user, we can assume that until Waste Generator type is available to use
    // Discuss rules for approving Forms by Waste Generator
    const form = await this.findByFormId(formId);

    return this.prismaService.form.update({
      where: {
        id: form.id,
      },
      data: {
        isFormAuthorizedByAdmin: isFormAuthorized,
      },
    });
  }

  async createOnPublicObject(fileName: string, basePath: string) {
    const publicBucket = 'detrash-public';

    const createPublicUrl = await this.s3Service.createPreSignedObjectUrl(
      fileName,
      '',
      basePath,
      publicBucket,
    );

    return createPublicUrl.createUrl;
  }

  async submitFormImage(formId: string) {
    const form = await this.findByFormId(formId);

    const createImageUrl = this.createOnPublicObject(
      `${form.id}.png`,
      'images',
    );

    return createImageUrl;
  }

  async createFormMetadata(formId: string) {
    const form = await this.findByFormId(formId);

    const [user, documents] = await Promise.all([
      this.usersService.findUserByUserId(form.userId),
      this.documentsService.listDocumentsFromForm(formId),
    ]);

    const residueAttributes = documents.reduce(
      (allAtributes, residueDocument) => {
        const residueTitleFormat = getResidueTitle(residueDocument.residueType);

        allAtributes.push({
          trait_type: `${residueTitleFormat} kgs`,
          value: String(residueDocument.amount),
        });

        return allAtributes;
      },
      [
        {
          trait_type: 'Originating email',
          value: user.email,
        },
        {
          trait_type: 'Originating wallet',
          value: form.walletAddress || '0x0',
        },
        {
          trait_type: 'Audit',
          value: form.isFormAuthorizedByAdmin ? 'Verified' : 'Not Verified',
        },
      ],
    );

    const fileName = `${form.id}.json`;
    const createMetadataUrl = await this.createOnPublicObject(
      fileName,
      'metadata',
    );
    const objectUrl = new URL(createMetadataUrl);

    const JsonMetadata = {
      attributes: residueAttributes,
      description: 'Recycling and composting report',
      image: `${objectUrl.origin}/images/${form.id}.png`,
      name: 'RECY Report',
    };

    const formMetadataUrl = `${objectUrl.origin}${objectUrl.pathname}`;

    await this.prismaService.form.update({
      where: {
        id: formId,
      },
      data: {
        formMetadataUrl,
      },
    });

    return {
      createMetadataUrl,
      body: JSON.stringify(JsonMetadata, null, 2),
    };
  }
}
