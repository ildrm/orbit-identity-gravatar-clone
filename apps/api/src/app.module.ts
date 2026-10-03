import { ConsentedAvatarController } from './applications/consented-avatar.controller.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthService } from './oauth/oauth.service.js';
import { EnterpriseController } from './enterprise/enterprise.controller.js';
import { MergeController } from './portability/merge.controller.js';
import { PreviewController } from './profile/preview.controller.js';
import { BlocksController } from './profile/blocks.controller.js';
import { CredentialSchemasController } from './credentials/schemas.controller.js';
import { CredentialsController } from './credentials/credentials.controller.js';
import { FederationMigrationController } from './federation/migration.controller.js';
import { FederationController } from './federation/federation.controller.js';
import { ActivityController } from './profile/activity.controller.js';
import { CustomDomainsController } from './verification/custom-domains.controller.js';
import { WebProofsController } from './verification/web-proofs.controller.js';
import { ImportController } from './portability/import.controller.js';
import { VersioningController } from './portability/versioning.controller.js';
import { LegacyController } from './portability/legacy.controller.js';
import { Module } from '@nestjs/common';
import { NotificationsController } from './auth/notifications.controller.js';
import { ResolverController } from './profile/resolver.controller.js';
import { ExtensionsController } from './profile/extensions.controller.js';
import { AccountController } from './auth/account.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { PasskeysController } from './auth/passkeys.controller.js';
import { IdentityController } from './identity/identity.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { DeveloperController } from './applications/developer.controller.js';
import { ApplicationsController } from './applications/applications.controller.js';
import { ApplicationsService } from './applications/applications.service.js';
import { AvatarController } from './media/avatar.controller.js';
import { MediaController } from './media/media.controller.js';
import { OrganizationsController } from './organizations/organizations.controller.js';
import { DomainsController } from './verification/domains.controller.js';
import { PortabilityController } from './portability/portability.controller.js';
import { AppealsController } from './moderation/appeals.controller.js';
import { ModerationController } from './moderation/moderation.controller.js';
import { ProvidersController } from './providers/providers.controller.js';
import { ContactController } from './contact/contact.controller.js';
@Module({
  controllers: [AuthController, PasskeysController, AccountController, NotificationsController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthenticationModule {}
@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentitiesModule {}
@Module({
  imports: [IdentitiesModule, AuthenticationModule],
  controllers: [
    ProfileController,
    BlocksController,
    PreviewController,
    ActivityController,
    FederationController,
    FederationMigrationController,
    ExtensionsController,
    ResolverController,
  ],
})
export class ProfilesModule {}
@Module({
  imports: [IdentitiesModule],
  controllers: [
    ApplicationsController,
    OAuthController,
    DeveloperController,
    ConsentedAvatarController,
  ],
  providers: [ApplicationsService, OAuthService],
})
export class ApplicationsModule {}
@Module({ imports: [IdentitiesModule], controllers: [MediaController, AvatarController] })
export class MediaModule {}
@Module({
  imports: [IdentitiesModule],
  controllers: [OrganizationsController, EnterpriseController],
})
export class OrganizationsModule {}
@Module({
  imports: [IdentitiesModule, AuthenticationModule],
  controllers: [
    DomainsController,
    CredentialsController,
    CredentialSchemasController,
    CustomDomainsController,
    WebProofsController,
  ],
})
export class VerificationModule {}
@Module({
  imports: [IdentitiesModule, AuthenticationModule],
  controllers: [
    PortabilityController,
    MergeController,
    LegacyController,
    VersioningController,
    ImportController,
  ],
})
export class PortabilityModule {}
@Module({ imports: [IdentitiesModule], controllers: [ModerationController, AppealsController] })
export class ModerationModule {}
@Module({ imports: [IdentitiesModule], controllers: [ProvidersController] })
export class ProvidersModule {}
@Module({ imports: [IdentitiesModule], controllers: [ContactController] })
export class ContactModule {}
@Module({
  imports: [
    AuthenticationModule,
    IdentitiesModule,
    ProfilesModule,
    ApplicationsModule,
    MediaModule,
    OrganizationsModule,
    VerificationModule,
    PortabilityModule,
    ModerationModule,
    ProvidersModule,
    ContactModule,
  ],
})
export class AppModule {}
